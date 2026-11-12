import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AppConfig, SttProviderId } from "../config/schema.js";

export const PROVIDERS = ["assemblyai", "deepgram", "openai_whisper"] as const;
export type CredentialPin = { provider: SttProviderId; accountId: string; credentialId: string };
export type AccessCheck = { state: "accepted" | "rejected" | "permission_unknown" | "unavailable"; checkedAt: string };
export type KeyRefusalKind = "rejected" | "exhausted";
export type KeyMark = { since: string; status: number | null };
/**
 * Two independent, latched facts, each set only from a definitive provider
 * answer. "exhausted" (no credit or quota) is cleared only by the operator's
 * "mark as available". "rejected" (access refused) is also cleared by an
 * accepted access check. Neither is ever cleared by the other or by a completed
 * request. A key is healthy when it has neither mark.
 */
export type KeyHealth = { exhausted: KeyMark | null; rejected: KeyMark | null };
export type FailoverParty = { accountId: string; label: string; provider: SttProviderId; keyHint: string };
/**
 * Operator-facing record of automatic routing. Never contains a key value.
 * "moved": `to` took over. "blocked": nothing was left. "stopped": a partly
 * transcribed recording stopped because `to`, the next candidate, is another
 * service; nothing took over for that recording.
 */
export type FailoverNotice = {
  id: string; kind: "moved" | "blocked" | "stopped"; reason: KeyRefusalKind; status: number | null;
  from: FailoverParty; to: FailoverParty | null; serviceChanged: boolean;
  count: number; firstAt: string; lastAt: string;
};
/**
 * Audit trail of automatic routing. "moved"/"blocked"/"recording_stopped"
 * follow a provider refusal of running work; "admitted"/"admission_blocked"
 * record new work that skipped a key already marked unhealthy (or found nothing
 * left). "recording_stopped" never rewrites a pin.
 */
export type FailoverEvent = {
  id: number; at: string; kind: "moved" | "blocked" | "recording_stopped" | "admitted" | "admission_blocked";
  workId: string | null; reason: KeyRefusalKind;
  status: number | null; from: CredentialPin; to: CredentialPin | null; serviceChanged: boolean;
};
/**
 * What the operator selected for a provider. "legacy" is the deliberate use of
 * the existing configuration. "unavailable" is a saved account he selected that
 * can no longer take new work (he disabled it, or its current key is revoked):
 * new work is refused, which must never be shown as the existing configuration.
 */
export type SelectionState =
  | { state: "legacy" }
  | { state: "selected"; accountId: string }
  | { state: "unavailable"; accountId: string; reason: "account_disabled" | "key_revoked" | "provider_mismatch" };
export type RefusalOutcome =
  | { moved: true; pin: CredentialPin; serviceChanged: boolean }
  | { moved: false; reason: "off" | "no_candidate" | "record_only" }
  | { moved: false; reason: "recording_stopped"; next: CredentialPin };
type AccountRow = { id: string; provider: SttProviderId; label: string; enabled: number; current_key: string; created_at: string };
type KeyRow = { id: string; account_id: string; hint: string; sealed: string; revoked: number; created_at: string; check_json: string | null };
type MarkRow = { credential_id: string; kind: KeyRefusalKind; since: string; status: number | null };
type NoticeRow = { id: string; kind: FailoverNotice["kind"]; reason: KeyRefusalKind; status: number | null;
  from_account_id: string; from_credential_id: string; to_account_id: string | null; to_credential_id: string | null;
  service_changed: number; count: number; first_at: string; last_at: string };
export class CredentialError extends Error {
  constructor(public code: string) { super(code); this.name = "CredentialError"; }
}

function canonical(path: string): string {
  const absolute = resolve(path);
  return existsSync(absolute) ? realpathSync(absolute) : join(canonical(dirname(absolute)), absolute.slice(dirname(absolute).length + 1));
}
function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
function validatePrivateDir(dir: string, forbidden: string[]): string {
  if (!isAbsolute(dir)) throw new CredentialError("private_directory_must_be_absolute");
  const path = resolve(dir);
  for (let cursor = path; ; cursor = dirname(cursor)) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new CredentialError("private_directory_symlink");
    if (dirname(cursor) === cursor) break;
  }
  for (const exposed of forbidden.map(canonical)) {
    if (contains(exposed, path) || contains(path, exposed)) throw new CredentialError("private_directory_overlaps_exports");
  }
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if ((lstatSync(path).mode & 0o077) !== 0) throw new CredentialError("private_directory_permissions");
  return path;
}
export function legacyKeys(config: AppConfig, provider: SttProviderId): string[] {
  const keys = provider === "assemblyai" ? [...(config.assemblyAiApiKeys ?? []), config.assemblyAiApiKey]
    : provider === "deepgram" ? [...(config.deepgramApiKeys ?? []), config.deepgramApiKey] : [config.openaiApiKey];
  return [...new Set(keys.filter((key): key is string => Boolean(key?.trim())).map((key) => key.trim()))];
}

/** Dedicated private database; never open under output, audio, or exported state. */
export class CredentialStore {
  private db: DatabaseSync;
  private key: Buffer;
  private fingerprintKey: Buffer;
  constructor(dir: string, master: string, forbidden: string[]) {
    if (!/^[a-fA-F0-9]{64}$/.test(master)) throw new CredentialError("invalid_credential_master_key");
    const rootKey = Buffer.from(master, "hex");
    this.key = Buffer.from(hkdfSync("sha256", rootKey, "media2text-credentials-v1", "encryption", 32));
    this.fingerprintKey = Buffer.from(hkdfSync("sha256", rootKey, "media2text-credentials-v1", "fingerprint", 32));
    rootKey.fill(0);
    const path = join(validatePrivateDir(dir, forbidden), "credentials.sqlite");
    if (existsSync(path) && (lstatSync(path).isSymbolicLink() || (lstatSync(path).mode & 0o077) !== 0)) {
      throw new CredentialError("private_database_permissions");
    }
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, provider TEXT NOT NULL, label TEXT NOT NULL,
        enabled INTEGER NOT NULL, current_key TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        fingerprint TEXT NOT NULL UNIQUE, hint TEXT NOT NULL, sealed TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, check_json TEXT);
      CREATE TABLE IF NOT EXISTS defaults (provider TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id));
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, account_id TEXT, credential_id TEXT);
      CREATE TABLE IF NOT EXISTS work_selections (work_id TEXT PRIMARY KEY, provider TEXT NOT NULL, account_id TEXT, credential_id TEXT, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS failover_order (account_id TEXT PRIMARY KEY REFERENCES accounts(id), position INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS key_order (credential_id TEXT PRIMARY KEY REFERENCES credentials(id), position INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS key_marks (credential_id TEXT NOT NULL REFERENCES credentials(id), kind TEXT NOT NULL,
        since TEXT NOT NULL, status INTEGER, PRIMARY KEY (credential_id, kind));
      CREATE TABLE IF NOT EXISTS failover_events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, work_id TEXT,
        reason TEXT NOT NULL, status INTEGER, from_provider TEXT NOT NULL, from_account_id TEXT NOT NULL,
        from_credential_id TEXT NOT NULL, to_provider TEXT, to_account_id TEXT, to_credential_id TEXT,
        service_changed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS failover_notices (id TEXT PRIMARY KEY, kind TEXT NOT NULL, reason TEXT NOT NULL, status INTEGER,
        from_account_id TEXT NOT NULL, from_credential_id TEXT NOT NULL, to_account_id TEXT, to_credential_id TEXT,
        service_changed INTEGER NOT NULL DEFAULT 0, count INTEGER NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL,
        dismissed_at TEXT);`);
    const check = this.db.prepare("SELECT value FROM metadata WHERE name='key_check'").get() as { value: string } | undefined;
    try {
      if (check) {
        if (this.unseal(check.value, "key_check") !== "media2text.credentials.v1") throw new Error();
      } else {
        this.db.prepare("INSERT INTO metadata VALUES ('key_check', ?)").run(this.seal("media2text.credentials.v1", "key_check"));
      }
    } catch { this.db.close(); throw new CredentialError("credential_store_locked"); }
  }
  close(): void { this.db.close(); this.key.fill(0); this.fingerprintKey.fill(0); }
  private seal(value: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(aad));
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `v1.${[iv, cipher.getAuthTag(), data].map((part) => part.toString("base64")).join(".")}`;
  }
  private unseal(value: string, aad: string): string {
    try {
      const [version, ...parts] = value.split(".");
      if (version !== "v1" || parts.length !== 3) throw new Error();
      const [iv, tag, data] = parts.map((part) => Buffer.from(part, "base64"));
      if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !data) throw new Error();
      const cipher = createDecipheriv("aes-256-gcm", this.key, iv, { authTagLength: 16 });
      cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
    } catch { throw new CredentialError("credential_store_locked"); }
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private audit(action: string, accountId?: string, credentialId?: string): void {
    this.db.prepare("INSERT INTO audit(at,action,account_id,credential_id) VALUES(?,?,?,?)")
      .run(new Date().toISOString(), action, accountId ?? null, credentialId ?? null);
  }
  private account(id: string): AccountRow {
    const account = this.db.prepare("SELECT * FROM accounts WHERE id=?").get(id) as AccountRow | undefined;
    if (!account) throw new CredentialError("account_not_found");
    return account;
  }
  private credential(id: string): KeyRow {
    const key = this.db.prepare("SELECT * FROM credentials WHERE id=?").get(id) as KeyRow | undefined;
    if (!key) throw new CredentialError("credential_not_found");
    return key;
  }
  list() {
    const accounts = this.db.prepare("SELECT * FROM accounts ORDER BY created_at,id").all() as AccountRow[];
    const defaults = this.db.prepare("SELECT provider,account_id FROM defaults").all() as { provider: SttProviderId; account_id: string }[];
    return accounts.map((account) => ({
      id: account.id, provider: account.provider, label: account.label, enabled: Boolean(account.enabled),
      selected: defaults.some((row) => row.account_id === account.id), currentCredentialId: account.current_key,
      createdAt: account.created_at, balance: { state: "unknown" as const, scope: "account" as const },
      // Attempt order used by automatic failover: current key first, then the operator's order.
      keyOrder: this.orderedKeys(account).filter((key) => !key.revoked).map((key) => key.id),
      keys: (this.db.prepare("SELECT id,hint,revoked,created_at,check_json FROM credentials WHERE account_id=? ORDER BY created_at,id")
        .all(account.id) as KeyRow[]).map((key) => ({ id: key.id, hint: `••••${key.hint}`, revoked: Boolean(key.revoked),
          createdAt: key.created_at, access: key.check_json ? JSON.parse(key.check_json) as AccessCheck : null,
          health: this.health(key.id) })),
    }));
  }
  private insertKey(accountId: string, token: string): string {
    const fingerprint = createHmac("sha256", this.fingerprintKey).update(`credential-fingerprint-v1:${token}`).digest("hex");
    if (this.db.prepare("SELECT id FROM credentials WHERE fingerprint=?").get(fingerprint)) throw new CredentialError("duplicate_credential");
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM credentials WHERE account_id=?").get(accountId) as { n: number };
    if (count.n >= 20) throw new CredentialError("credential_limit");
    const id = randomUUID();
    this.db.prepare("INSERT INTO credentials(id,account_id,fingerprint,hint,sealed,created_at) VALUES(?,?,?,?,?,?)")
      .run(id, accountId, fingerprint, token.slice(-4), this.seal(token, `v1:${this.account(accountId).provider}:${accountId}:${id}`), new Date().toISOString());
    this.db.prepare("UPDATE accounts SET current_key=? WHERE id=?").run(id, accountId);
    this.audit("add_key", accountId, id);
    return id;
  }
  create(provider: SttProviderId, label: string, tokens: string[]): string {
    return this.atomic(() => {
      const count = this.db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number };
      if (count.n >= 100) throw new CredentialError("account_limit");
      if (!tokens.length) throw new CredentialError("legacy_credential_missing");
      const id = randomUUID();
      this.db.prepare("INSERT INTO accounts VALUES(?,?,?,1,'',?)").run(id, provider, label, new Date().toISOString());
      for (const token of tokens) this.insertKey(id, token);
      this.audit("create", id); return id;
    });
  }
  addKey(accountId: string, token: string): string {
    return this.atomic(() => { this.account(accountId); return this.insertKey(accountId, token); });
  }
  rename(accountId: string, label: string): void {
    this.atomic(() => { this.account(accountId); this.db.prepare("UPDATE accounts SET label=? WHERE id=?").run(label, accountId); this.audit("rename", accountId); });
  }
  enable(accountId: string, enabled: boolean): void {
    this.atomic(() => { this.account(accountId); this.db.prepare("UPDATE accounts SET enabled=? WHERE id=?").run(enabled ? 1 : 0, accountId); this.audit(enabled ? "enable" : "disable", accountId); });
  }
  select(accountId: string): void {
    this.atomic(() => {
      const account = this.account(accountId);
      if (!account.enabled || this.credential(account.current_key).revoked) throw new CredentialError("account_not_ready");
      this.db.prepare("INSERT OR REPLACE INTO defaults VALUES(?,?)").run(account.provider, accountId); this.audit("select", accountId);
    });
  }
  useLegacy(provider: SttProviderId): void {
    this.atomic(() => { this.db.prepare("DELETE FROM defaults WHERE provider=?").run(provider); this.audit(`select_legacy:${provider}`); });
  }
  useKey(accountId: string, credentialId: string): void {
    this.atomic(() => {
      const key = this.credential(credentialId);
      if (key.account_id !== accountId || key.revoked) throw new CredentialError("credential_unavailable");
      this.db.prepare("UPDATE accounts SET current_key=? WHERE id=?").run(credentialId, accountId); this.audit("select_key", accountId, credentialId);
    });
  }
  revoke(accountId: string, credentialId: string): void {
    this.atomic(() => {
      if (this.credential(credentialId).account_id !== accountId) throw new CredentialError("credential_unavailable");
      this.db.prepare("UPDATE credentials SET revoked=1 WHERE id=?").run(credentialId); this.audit("revoke_local", accountId, credentialId);
    });
  }
  /** Same judgement as pin(), reported instead of thrown. */
  selection(provider: SttProviderId): SelectionState {
    const row = this.db.prepare("SELECT account_id FROM defaults WHERE provider=?").get(provider) as { account_id: string } | undefined;
    if (!row) return { state: "legacy" };
    const account = this.account(row.account_id);
    const reason = account.provider !== provider ? "provider_mismatch" as const
      : !account.enabled ? "account_disabled" as const
        : this.credential(account.current_key).revoked ? "key_revoked" as const : undefined;
    return reason ? { state: "unavailable", accountId: account.id, reason } : { state: "selected", accountId: account.id };
  }
  pin(provider: SttProviderId): CredentialPin | undefined {
    const selection = this.selection(provider);
    if (selection.state === "legacy") return undefined;
    if (selection.state === "unavailable") throw new CredentialError("selected_account_unavailable");
    return { provider, accountId: selection.accountId, credentialId: this.account(selection.accountId).current_key };
  }
  resolve(pin: CredentialPin): string {
    const account = this.account(pin.accountId);
    const key = this.credential(pin.credentialId);
    // Ordinary disable/rotation applies to new work. Revocation also blocks pinned work.
    if (key.revoked) throw new CredentialError("credential_revoked_local");
    if (account.provider !== pin.provider || key.account_id !== account.id) throw new CredentialError("credential_unavailable");
    return this.unseal(key.sealed, `v1:${account.provider}:${account.id}:${key.id}`);
  }
  recordWork(workId: string, provider: SttProviderId, pin?: CredentialPin): void {
    this.atomic(() => {
      // Called only for a newly admitted job. A previous cross-database rollback
      // or terminal intake pruning can leave the same deterministic ID here.
      this.db.prepare(`INSERT INTO work_selections VALUES(?,?,?,?,?)
        ON CONFLICT(work_id) DO UPDATE SET provider=excluded.provider,
          account_id=excluded.account_id, credential_id=excluded.credential_id,
          at=excluded.at`)
        .run(workId, provider, pin?.accountId ?? null, pin?.credentialId ?? null, new Date().toISOString());
    });
  }
  workSelection(workId: string): { provider: SttProviderId; pin: CredentialPin | null } | undefined {
    const row = this.db.prepare("SELECT * FROM work_selections WHERE work_id=?").get(workId) as
      { provider: SttProviderId; account_id: string | null; credential_id: string | null } | undefined;
    if (!row) return undefined;
    return { provider: row.provider, pin: row.account_id && row.credential_id
      ? { provider: row.provider, accountId: row.account_id, credentialId: row.credential_id } : null };
  }
  probeKey(accountId: string): { pin: CredentialPin; token: string } {
    const account = this.account(accountId);
    const pin = { provider: account.provider, accountId, credentialId: account.current_key };
    return { pin, token: this.resolve(pin) };
  }
  recordCheck(pin: CredentialPin, check: AccessCheck): void {
    this.atomic(() => {
      if (this.credential(pin.credentialId).account_id !== pin.accountId) throw new CredentialError("credential_unavailable");
      this.db.prepare("UPDATE credentials SET check_json=? WHERE id=?").run(JSON.stringify(check), pin.credentialId);
      this.audit("probe", pin.accountId, pin.credentialId);
      // The operator's re-check is a definitive provider answer about access only.
      // It can set or clear "rejected". It never proves credit, so it never
      // touches "exhausted", whatever happened to the key in between.
      if (check.state === "rejected") this.mark(pin, "rejected", 401);
      else if (check.state === "accepted") this.clearMark(pin, "rejected");
    });
  }

  // ---- Automatic key/account failover (D-029) ----------------------------

  private health(credentialId: string): KeyHealth {
    const rows = this.db.prepare("SELECT * FROM key_marks WHERE credential_id=?").all(credentialId) as MarkRow[];
    const of = (kind: KeyRefusalKind): KeyMark | null => {
      const row = rows.find((item) => item.kind === kind);
      return row ? { since: row.since, status: row.status } : null;
    };
    return { exhausted: of("exhausted"), rejected: of("rejected") };
  }
  private healthy(credentialId: string): boolean {
    return !this.db.prepare("SELECT 1 FROM key_marks WHERE credential_id=?").get(credentialId);
  }
  /** Caller must be inside atomic(). A mark keeps the time it was first set; only new marks are audited. */
  private mark(pin: CredentialPin, kind: KeyRefusalKind, status: number | null): void {
    if (this.health(pin.credentialId)[kind]) return;
    this.db.prepare("INSERT INTO key_marks VALUES(?,?,?,?)").run(pin.credentialId, kind, new Date().toISOString(), status);
    this.audit(`health_${kind}`, pin.accountId, pin.credentialId);
  }
  /** Caller must be inside atomic(). Clears exactly one fact and never the other. */
  private clearMark(pin: CredentialPin, kind: KeyRefusalKind): void {
    if (!this.health(pin.credentialId)[kind]) return;
    this.db.prepare("DELETE FROM key_marks WHERE credential_id=? AND kind=?").run(pin.credentialId, kind);
    this.audit(`health_${kind}_cleared`, pin.accountId, pin.credentialId);
  }
  /** Current key first, then the operator's explicit order, then newest first. */
  private orderedKeys(account: AccountRow): KeyRow[] {
    const keys = this.db.prepare(`SELECT c.*, o.position AS position FROM credentials c
      LEFT JOIN key_order o ON o.credential_id=c.id WHERE c.account_id=?
      ORDER BY (o.position IS NULL), o.position, c.created_at DESC, c.id`).all(account.id) as KeyRow[];
    return [...keys.filter((key) => key.id === account.current_key), ...keys.filter((key) => key.id !== account.current_key)];
  }
  failoverOrder(): string[] {
    return (this.db.prepare("SELECT account_id FROM failover_order ORDER BY position, account_id").all() as { account_id: string }[])
      .map((row) => row.account_id);
  }
  failoverEnabled(): boolean {
    const row = this.db.prepare("SELECT value FROM metadata WHERE name='failover_enabled'").get() as { value: string } | undefined;
    return row?.value === "1";
  }
  setFailover(enabled: boolean): void {
    this.atomic(() => {
      this.db.prepare("INSERT OR REPLACE INTO metadata VALUES('failover_enabled', ?)").run(enabled ? "1" : "0");
      this.audit(enabled ? "failover_on" : "failover_off");
    });
  }
  /** Replaces the operator's ordered list. Only listed accounts can ever take over work. */
  setFailoverOrder(accountIds: string[]): void {
    this.atomic(() => {
      if (new Set(accountIds).size !== accountIds.length) throw new CredentialError("invalid_failover_order");
      for (const id of accountIds) this.account(id);
      this.db.prepare("DELETE FROM failover_order").run();
      accountIds.forEach((id, position) => this.db.prepare("INSERT INTO failover_order VALUES(?,?)").run(id, position));
      this.audit("failover_order");
    });
  }
  setKeyOrder(accountId: string, credentialIds: string[]): void {
    this.atomic(() => {
      this.account(accountId);
      if (new Set(credentialIds).size !== credentialIds.length) throw new CredentialError("invalid_key_order");
      for (const id of credentialIds) if (this.credential(id).account_id !== accountId) throw new CredentialError("credential_unavailable");
      this.db.prepare("DELETE FROM key_order WHERE credential_id IN (SELECT id FROM credentials WHERE account_id=?)").run(accountId);
      credentialIds.forEach((id, position) => this.db.prepare("INSERT INTO key_order VALUES(?,?)").run(id, position));
      this.audit("key_order", accountId);
    });
  }
  /**
   * Operator "mark as available": the only action that clears "exhausted", and
   * it clears "rejected" too. A completed request never clears either mark,
   * because it may have been accepted before the refusal.
   */
  resetKeyHealth(accountId: string, credentialId: string): void {
    this.atomic(() => {
      if (this.credential(credentialId).account_id !== accountId) throw new CredentialError("credential_unavailable");
      const pin = { provider: this.account(accountId).provider, accountId, credentialId };
      this.clearMark(pin, "exhausted");
      this.clearMark(pin, "rejected");
    });
  }
  /**
   * Next enabled, healthy, non-revoked key, judged on the state at this moment:
   * the rest of the same account in key order, then the operator's listed
   * accounts from the top. Disabled accounts, revoked keys, keys marked rejected
   * or exhausted and the `excluded` keys (already refused for the recording
   * being moved) are never candidates.
   */
  private nextCandidate(startAccountId: string, excluded: ReadonlySet<string> = new Set()): CredentialPin | undefined {
    for (const accountId of [...new Set([startAccountId, ...this.failoverOrder()])]) {
      const account = this.db.prepare("SELECT * FROM accounts WHERE id=?").get(accountId) as AccountRow | undefined;
      if (!account?.enabled) continue;
      const key = this.orderedKeys(account).find((item) => !item.revoked && !excluded.has(item.id) && this.healthy(item.id));
      if (key) return { provider: account.provider, accountId: account.id, credentialId: key.id };
    }
    return undefined;
  }
  /**
   * Caller must be inside atomic(). Every call writes an audit event and
   * produces a pending notice: identical pending ones share a row and a counter,
   * and a notice the operator dismissed never silences the next occurrence.
   * `to` is what took over, or for "recording_stopped" the candidate that could
   * not be used for that recording.
   */
  private recordFailover(kind: FailoverEvent["kind"], workId: string | null, from: CredentialPin, to: CredentialPin | undefined,
    reason: KeyRefusalKind, status: number | null): void {
    const now = new Date().toISOString();
    const stopped = kind === "recording_stopped";
    const serviceChanged = !stopped && to && to.provider !== from.provider ? 1 : 0;
    this.db.prepare(`INSERT INTO failover_events(at,kind,work_id,reason,status,from_provider,from_account_id,from_credential_id,
      to_provider,to_account_id,to_credential_id,service_changed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(now, kind, workId, reason, status, from.provider, from.accountId, from.credentialId,
        to?.provider ?? null, to?.accountId ?? null, to?.credentialId ?? null, serviceChanged);
    if (kind === "moved" || kind === "blocked" || stopped) this.audit(`failover_${kind}`, from.accountId, from.credentialId);
    const noticeKind: FailoverNotice["kind"] = stopped ? "stopped" : to ? "moved" : "blocked";
    const pending = this.db.prepare(`SELECT id FROM failover_notices WHERE dismissed_at IS NULL AND kind=? AND reason=?
      AND from_credential_id=? AND to_credential_id IS ?`)
      .get(noticeKind, reason, from.credentialId, to?.credentialId ?? null) as { id: string } | undefined;
    if (pending) {
      this.db.prepare("UPDATE failover_notices SET count=count+1, last_at=?, status=? WHERE id=?").run(now, status, pending.id);
      return;
    }
    this.db.prepare("INSERT INTO failover_notices VALUES(?,?,?,?,?,?,?,?,?,1,?,?,NULL)")
      .run(randomUUID(), noticeKind, reason, status, from.accountId, from.credentialId, to?.accountId ?? null,
        to?.credentialId ?? null, serviceChanged, now, now);
  }
  /**
   * The provider definitively refused `pin` before accepting work. The key's
   * mark is always recorded first. Whether the named work may move is decided
   * BEFORE anything is rewritten, on the state at this moment and inside this
   * transaction:
   * - `recordOnly` (the work was cancelled): mark only.
   * - switch off: mark only.
   * - the candidate is chosen now by health, availability and order, never from
   *   an earlier decision, and never among `exclude`: the keys this recording
   *   was already refused with. So a sibling's earlier destination is used only
   *   if it is still healthy, and a key the operator re-enabled meanwhile is
   *   not handed back to a recording it already refused.
   * - nothing is left: "blocked" event and notice.
   * - `sameProviderOnly` (part of this recording was already accepted by this
   *   provider) and the candidate is another service: a distinct
   *   "recording_stopped" event and notice; no pin is rewritten.
   * - otherwise this recording moves, and that transition is audited and
   *   noticed every time, also when another recording of the same run already
   *   made the same one.
   * Other work pinned to the same key is never touched.
   */
  recordRefusal(input: { pin: CredentialPin; kind: KeyRefusalKind; status: number; workIds: string[];
    sameProviderOnly?: boolean; recordOnly?: boolean; exclude?: string[] }): RefusalOutcome {
    return this.atomic((): RefusalOutcome => {
      const { pin, kind, status } = input;
      const account = this.account(pin.accountId);
      if (account.provider !== pin.provider || this.credential(pin.credentialId).account_id !== account.id) {
        throw new CredentialError("credential_unavailable");
      }
      this.mark(pin, kind, status);
      if (input.recordOnly) return { moved: false, reason: "record_only" };
      if (!this.failoverEnabled()) return { moved: false, reason: "off" };
      const next = this.nextCandidate(account.id, new Set([pin.credentialId, ...(input.exclude ?? [])]));
      const workId = input.workIds[0] ?? null;
      if (!next) {
        this.recordFailover("blocked", workId, pin, undefined, kind, status);
        return { moved: false, reason: "no_candidate" };
      }
      if (input.sameProviderOnly && next.provider !== pin.provider) {
        this.recordFailover("recording_stopped", workId, pin, next, kind, status);
        return { moved: false, reason: "recording_stopped", next };
      }
      this.recordFailover("moved", workId, pin, next, kind, status);
      for (const id of input.workIds) {
        this.db.prepare("UPDATE work_selections SET provider=?, account_id=?, credential_id=?, at=? WHERE work_id=?")
          .run(next.provider, next.accountId, next.credentialId, new Date().toISOString(), id);
      }
      return { moved: true, pin: next, serviceChanged: next.provider !== pin.provider };
    });
  }
  /**
   * Pin for newly admitted work. With the switch off this is exactly pin(). With
   * it on, a selected key already marked rejected/exhausted is skipped for the
   * next candidate, and every such admission is audited and noticed. A selected
   * account the operator disabled or revoked still fails closed, as before.
   */
  pinForNewWork(provider: SttProviderId, workId?: string): CredentialPin | undefined {
    const primary = this.pin(provider);
    if (!primary || !this.failoverEnabled()) return primary;
    const marks = this.health(primary.credentialId);
    const reason: KeyRefusalKind | undefined = marks.exhausted ? "exhausted" : marks.rejected ? "rejected" : undefined;
    if (!reason) return primary;
    const status = marks[reason]!.status;
    const next = this.atomic(() => {
      const candidate = this.nextCandidate(primary.accountId);
      this.recordFailover(candidate ? "admitted" : "admission_blocked", workId ?? null, primary, candidate, reason, status);
      return candidate;
    });
    if (!next) throw new CredentialError("no_healthy_account_available");
    return next;
  }
  /**
   * Rendered only for the authenticated accounts screen and its notice. Audit
   * rows, failover events and stored notices hold identifiers, never a key hint.
   */
  private party(accountId: string, credentialId: string): FailoverParty {
    const account = this.account(accountId);
    return { accountId, label: account.label, provider: account.provider, keyHint: `••••${this.credential(credentialId).hint}` };
  }
  notices(): FailoverNotice[] {
    const rows = this.db.prepare("SELECT * FROM failover_notices WHERE dismissed_at IS NULL ORDER BY last_at DESC, id").all() as NoticeRow[];
    return rows.map((row) => ({ id: row.id, kind: row.kind, reason: row.reason, status: row.status,
      from: this.party(row.from_account_id, row.from_credential_id),
      to: row.to_account_id && row.to_credential_id ? this.party(row.to_account_id, row.to_credential_id) : null,
      serviceChanged: Boolean(row.service_changed), count: row.count, firstAt: row.first_at, lastAt: row.last_at }));
  }
  dismissNotice(noticeId: string): void {
    this.atomic(() => {
      const row = this.db.prepare("SELECT from_account_id, from_credential_id FROM failover_notices WHERE id=? AND dismissed_at IS NULL")
        .get(noticeId) as { from_account_id: string; from_credential_id: string } | undefined;
      if (!row) throw new CredentialError("notice_not_found");
      this.db.prepare("UPDATE failover_notices SET dismissed_at=? WHERE id=?").run(new Date().toISOString(), noticeId);
      this.audit("failover_notice_dismissed", row.from_account_id, row.from_credential_id);
    });
  }
  failoverEvents(limit = 100): FailoverEvent[] {
    const rows = this.db.prepare("SELECT * FROM failover_events ORDER BY id DESC LIMIT ?").all(Math.max(1, Math.min(1000, limit))) as Array<{
      id: number; at: string; kind: FailoverEvent["kind"]; work_id: string | null; reason: KeyRefusalKind; status: number | null;
      from_provider: SttProviderId; from_account_id: string; from_credential_id: string;
      to_provider: SttProviderId | null; to_account_id: string | null; to_credential_id: string | null; service_changed: number }>;
    return rows.map((row) => ({ id: row.id, at: row.at, kind: row.kind, workId: row.work_id, reason: row.reason, status: row.status,
      from: { provider: row.from_provider, accountId: row.from_account_id, credentialId: row.from_credential_id },
      to: row.to_provider && row.to_account_id && row.to_credential_id
        ? { provider: row.to_provider, accountId: row.to_account_id, credentialId: row.to_credential_id } : null,
      serviceChanged: Boolean(row.service_changed) }));
  }
  /**
   * Read-only view for the settings screen and the status route. `selection`
   * says what the operator chose, including a chosen account that can no longer
   * take work. `effective` is where new work for `provider` would go right now.
   * `blocked` means the switch is on, the selected key is marked unhealthy and
   * nothing listed can take over.
   */
  failoverState(provider: SttProviderId) {
    const enabled = this.failoverEnabled();
    const notices = this.notices();
    const selection = this.selection(provider);
    let effective: CredentialPin | null = null;
    let blocked = false;
    if (selection.state === "selected") {
      const primary = this.pin(provider)!;
      effective = !enabled || this.healthy(primary.credentialId) ? primary : this.nextCandidate(primary.accountId) ?? null;
      blocked = enabled && !effective;
    }
    const unhealthy = this.db.prepare(`SELECT COUNT(DISTINCT m.credential_id) AS n FROM key_marks m
      JOIN credentials c ON c.id=m.credential_id WHERE c.revoked=0`).get() as { n: number };
    return { enabled, order: this.failoverOrder(), selection, effective, blocked, unhealthyKeys: unhealthy.n, notices };
  }
  /**
   * Notices plus where new work goes right now, for the banner shown on every
   * screen. No account listing, no legacy key suffix; a key hint appears only
   * inside a notice. `state` tells apart the existing configuration, a working
   * account, a selected account that refuses new work, and nothing left.
   * `view` marks the answer, so a reader can tell it from the account listing
   * that an older API returns for the same request.
   */
  noticesView(provider: SttProviderId) {
    const view = this.failoverState(provider);
    const { selection } = view;
    const state = selection.state === "legacy" ? "legacy" as const
      : selection.state === "unavailable" ? "unavailable" as const
        : view.blocked ? "blocked" as const : "account" as const;
    const accountId = view.effective?.accountId ?? (selection.state === "legacy" ? undefined : selection.accountId);
    const account = accountId ? this.account(accountId) : undefined;
    return { view: "notices" as const, notices: view.notices, routing: { enabled: view.enabled, state,
      reason: selection.state === "unavailable" ? selection.reason : null,
      provider: account?.provider ?? provider, accountLabel: account?.label ?? null } };
  }
}

export function openCredentialStore(config: AppConfig): CredentialStore | undefined {
  const dir = process.env.Y2T_CREDENTIALS_DIR?.trim();
  const master = process.env.Y2T_CREDENTIAL_MASTER_KEY?.trim();
  if (!dir && !master) return undefined;
  if (!dir || !master) throw new CredentialError("credential_store_not_configured");
  return new CredentialStore(dir, master, [config.outputDir, config.audioDir]);
}
export function applyCredential(config: AppConfig, pin: CredentialPin, store: CredentialStore): AppConfig {
  const token = store.resolve(pin);
  return { ...config, sttProvider: pin.provider, assemblyAiApiKeys: undefined, deepgramApiKeys: undefined,
    assemblyAiApiKey: pin.provider === "assemblyai" ? token : undefined,
    deepgramApiKey: pin.provider === "deepgram" ? token : undefined,
    openaiApiKey: pin.provider === "openai_whisper" ? token : undefined };
}

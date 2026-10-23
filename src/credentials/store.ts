import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AppConfig, SttProviderId } from "../config/schema.js";

export const PROVIDERS = ["assemblyai", "deepgram", "openai_whisper"] as const;
export type CredentialPin = { provider: SttProviderId; accountId: string; credentialId: string };
export type AccessCheck = { state: "accepted" | "rejected" | "permission_unknown" | "unavailable"; checkedAt: string };
type AccountRow = { id: string; provider: SttProviderId; label: string; enabled: number; current_key: string; created_at: string };
type KeyRow = { id: string; account_id: string; hint: string; sealed: string; revoked: number; created_at: string; check_json: string | null };
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
      CREATE TABLE IF NOT EXISTS work_selections (work_id TEXT PRIMARY KEY, provider TEXT NOT NULL, account_id TEXT, credential_id TEXT, at TEXT NOT NULL);`);
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
      keys: (this.db.prepare("SELECT id,hint,revoked,created_at,check_json FROM credentials WHERE account_id=? ORDER BY created_at,id")
        .all(account.id) as KeyRow[]).map((key) => ({ id: key.id, hint: `••••${key.hint}`, revoked: Boolean(key.revoked),
          createdAt: key.created_at, access: key.check_json ? JSON.parse(key.check_json) as AccessCheck : null })),
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
  pin(provider: SttProviderId): CredentialPin | undefined {
    const row = this.db.prepare("SELECT account_id FROM defaults WHERE provider=?").get(provider) as { account_id: string } | undefined;
    if (!row) return undefined;
    const account = this.account(row.account_id);
    if (account.provider !== provider || !account.enabled || this.credential(account.current_key).revoked) throw new CredentialError("selected_account_unavailable");
    return { provider, accountId: account.id, credentialId: account.current_key };
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
    });
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

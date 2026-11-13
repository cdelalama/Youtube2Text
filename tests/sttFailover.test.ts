import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { RunManager, type RunCreateRequest, type RunRecord } from "../src/api/runManager.js";
import { startApiServer } from "../src/api/server.js";
import { configSchema, type AppConfig, type SttProviderId } from "../src/config/schema.js";
import { signAdminProof } from "../src/credentials/adminProof.js";
import { CredentialError, CredentialStore, NOTICES_VIEW_LIMIT, type CredentialPin } from "../src/credentials/store.js";
import type { PipelineEvent } from "../src/pipeline/events.js";
import { runPipeline } from "../src/pipeline/run.js";
import {
  createSttSession,
  FailoverExhaustedError,
  FailoverRepeatedCandidateError,
  RecordingStoppedError,
  ServiceChangedSignal,
  type PipelineFailover,
} from "../src/pipeline/sttSession.js";
import {
  AssemblyAiClient,
  classifyAssemblyAiSubmissionRefusal,
} from "../src/transcription/assemblyai/client.js";
import { classifyDeepgramRefusal, DeepgramProvider } from "../src/transcription/deepgram/index.js";
import {
  definitiveRefusalOf,
  InsufficientCreditsError,
  ProviderHttpError,
  DEEPGRAM_ERROR_LABELS,
  fixedLabel,
  OPENAI_ERROR_LABELS,
  ProviderError,
  ProviderRefusalError,
  type ProviderRefusalKind,
} from "../src/transcription/errors.js";
import type { TranscriptionProvider } from "../src/transcription/index.js";
import { MultiKeyProvider } from "../src/transcription/loadBalancer.js";
import { classifyOpenAiRefusal, OpenAiWhisperProvider } from "../src/transcription/openai/index.js";
import type { TranscriptJson, TranscriptionOptions } from "../src/transcription/types.js";
import { TranscriptStore } from "../src/transcripts/store.js";
import { UsageLedger, type UsagePolicy } from "../src/usage/index.js";
import { proxyPublicMediaStatus } from "../web/lib/publicStatusProxy.js";
import { proxyCredentials } from "../web/lib/credentialProxy.js";
import { createNoticeReader, createNoticeReadTracker, failoverNoticeText, failoverNoticeTitle, failoverReadFailureText, failoverRoutingText, moreNoticesCount, routingRefusesNewWork, type FailoverNotice, type FailoverRouting } from "../web/lib/failoverNotices.js";
import { runAccountAction } from "../web/lib/accountAction.js";
import { isExactNoticesQuery, readNoticesView } from "../web/lib/failoverNoticesProxy.js";
import { createSnapshotGate } from "../web/lib/snapshotGate.js";
import { issueWebSessionToken, WEB_SESSION_COOKIE } from "../web/lib/webAuth.js";

// Every provider in this file is a local fake. Nothing here can reach a real
// speech-to-text service or spend credit.
const master = "ab".repeat(32);
// The last four characters are distinctive and not hexadecimal, so a leaked key
// hint cannot be confused with part of an identifier or a timestamp.
const K1 = "Gz7Q-synthetic-failover-key-one-QZX1";
const K2 = "Hy8R-synthetic-failover-key-two-WVY2";
const K3 = "Jx9S-synthetic-failover-key-three-HJK3";
const K4 = "Kw6T-synthetic-failover-key-four-MNP4";
const LEGACY_KEY = "Lv5U-synthetic-legacy-environment-key-RTG5";
const ALL_KEYS = [K1, K2, K3, K4];
const HINTS = [...ALL_KEYS, LEGACY_KEY].map((key) => key.slice(-4));

type Call = { path: string; opts: TranscriptionOptions };
type Behaviour = (call: Call) => TranscriptJson | Promise<TranscriptJson>;
const completed = (text: string) => (): TranscriptJson => ({ id: `fake-${text}`, status: "completed", text });
const refuse = (provider: SttProviderId, kind: ProviderRefusalKind, status: number) => (): TranscriptJson => {
  throw new ProviderRefusalError({ provider, kind, status }, provider);
};
const fail = (error: Error) => (): TranscriptJson => { throw error; };
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function until(condition: () => boolean, label: string): Promise<void> {
  for (let waited = 0; !condition(); waited += 5) {
    assert.ok(waited < 30_000, `timed out waiting for ${label}`);
    await new Promise((done) => setTimeout(done, 5));
  }
}
const pieceOptions = { pollIntervalMs: 0, maxPollMinutes: 1, retries: 0, providerTimeoutMs: 1000 };

function policy(overrides: Partial<UsagePolicy> = {}): UsagePolicy {
  return { enforcement: "enforce", maxItemMinutes: 0, maxRunMinutes: 0, maxSourceMinutes24h: 0, maxTotalMinutes30d: 0,
    maxTotalUsd30d: 0, ratesUsdPerHour: { assemblyai: 1, deepgram: 1, openai_whisper: 1 }, ...overrides };
}

type PipelineFn = NonNullable<NonNullable<ConstructorParameters<typeof RunManager>[1]["deps"]>["runPipeline"]>;

function fixtureConfig(): AppConfig {
  return configSchema.parse({ sttProvider: "deepgram", deepgramApiKey: LEGACY_KEY, commentsEnabled: false, assemblyAiCreditsCheck: "none" });
}

/** `pipeline` replaces the real pipeline, to drive several recordings of one run at once. */
function fixture(usagePolicy: UsagePolicy = policy(), caps: { maxAudioBytes?: number } = {}, pipeline?: PipelineFn,
  realProvider?: (config: AppConfig) => TranscriptionProvider) {
  const root = mkdtempSync(join(tmpdir(), "m2t-failover-"));
  const config = configSchema.parse({ outputDir: join(root, "output"), audioDir: join(root, "audio"),
    sttProvider: "deepgram", deepgramApiKey: LEGACY_KEY, commentsEnabled: false, assemblyAiCreditsCheck: "none" });
  const dir = join(root, "private");
  const store = new CredentialStore(dir, master, [config.outputDir, config.audioDir]);
  const source = join(root, "source.mp3");
  writeFileSync(source, "fake-audio", "utf8");
  const ledger = new UsageLedger(config.outputDir, { policy: usagePolicy });
  const behaviours = new Map<string, Behaviour>();
  const calls: Array<{ provider: SttProviderId; key: string }> = [];
  const events: PipelineEvent[] = [];
  const keyOf = (c: AppConfig) => (c.sttProvider === "deepgram" ? c.deepgramApiKey
    : c.sttProvider === "assemblyai" ? c.assemblyAiApiKey : c.openaiApiKey) ?? "";
  const createTranscriptionProvider = (c: AppConfig): TranscriptionProvider => ({
    name: c.sttProvider,
    getCapabilities: () => ({ supportsDiarization: true, ...caps }),
    transcribe: async (path, opts) => {
      const key = keyOf(c);
      calls.push({ provider: c.sttProvider, key });
      return (behaviours.get(key) ?? completed("default"))({ path, opts });
    },
  });
  const deps = { createTranscriptionProvider: realProvider ?? createTranscriptionProvider, getAudioDurationSeconds: async () => 120, usageLedger: ledger,
    splitAudioByLimit: async (path: string) => ({ cleanup: async () => undefined,
      chunks: [{ path, startSeconds: 0, overlapSeconds: 0 }, { path, startSeconds: 60, overlapSeconds: 0 }] }) };
  const manager = new RunManager(config, { persistRuns: false, maxBufferedEventsPerRun: 50, credentialStore: store,
    deps: { runPipeline: pipeline ?? ((input, effective, options) => runPipeline(input, effective, { ...options,
      emitter: { emit: (event) => { events.push(event); options.emitter?.emit(event); } }, deps })) } });
  let next = 0;
  const request = (): RunCreateRequest => ({ audioId: `audio-${next += 1}`, audioPath: source });
  const start = async (run: RunRecord, req: RunCreateRequest): Promise<RunRecord> => {
    manager.startRun(run.runId, req);
    assert.equal(await manager.waitForIdle(30_000), true);
    return manager.getRun(run.runId)!;
  };
  const job = async (): Promise<RunRecord> => { const req = request(); return start(manager.createRun(req), req); };
  const keyOfAccount = (accountId: string, token: string) =>
    store.list().find((item) => item.id === accountId)!.keys.find((key) => key.hint.endsWith(token.slice(-4)))!;
  const keyId = (accountId: string, token: string) => keyOfAccount(accountId, token).id;
  const marks = (accountId: string, token: string) => keyOfAccount(accountId, token).health;
  const health = (accountId: string, token: string) => {
    const mark = marks(accountId, token);
    return mark.exhausted && mark.rejected ? "exhausted+rejected" : mark.exhausted ? "exhausted" : mark.rejected ? "rejected" : "ok";
  };
  const privateBytes = () => readFileSync(join(dir, "credentials.sqlite"));
  const auditRows = () => {
    const db = new DatabaseSync(join(dir, "credentials.sqlite"), { readOnly: true });
    try { return db.prepare("SELECT action, account_id, credential_id FROM audit ORDER BY id").all() as Array<{ action: string }>; }
    finally { db.close(); }
  };
  /** Every stored row of the audit trail, events and notices, exactly as written. */
  const storedTrail = () => {
    const db = new DatabaseSync(join(dir, "credentials.sqlite"), { readOnly: true });
    try { return JSON.stringify(["audit", "failover_events", "failover_notices", "key_marks", "work_selections"].map((table) => db.prepare(`SELECT * FROM ${table}`).all())); }
    finally { db.close(); }
  };
  const f = { root, dir, config, store, source, ledger, behaviours, calls, events, manager, deps, request, start, job, keyId, health, marks,
    privateBytes, auditRows, storedTrail, usedKeys: () => calls.map((call) => call.key),
    /** Simulates a process restart of the private store (the manager keeps the old handle). */
    reopen: () => { f.store.close(); f.store = new CredentialStore(dir, master, [config.outputDir, config.audioDir]); return f.store; },
    cleanup: () => { try { f.store.close(); } catch { /* already closed */ } rmSync(root, { recursive: true, force: true }); } };
  return f;
}

function assertNoSecret(label: string, value: unknown): void {
  const text = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
  for (const key of ALL_KEYS) assert.equal(text.includes(Buffer.from(key)), false, `${label} must not contain a key value`);
}

test("failover: switch is off by default and an existing private database is upgraded in place", () => {
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Personal", [K1]); f.store.select(a);
    assert.equal(f.store.failoverEnabled(), false, "installing the release must not turn failover on");
    assert.deepEqual(f.store.failoverOrder(), []);
    assert.deepEqual(f.store.pinForNewWork("deepgram"), f.store.pin("deepgram"));
    // A database written before this release has none of the new tables.
    const legacy = new DatabaseSync(join(f.dir, "credentials.sqlite"));
    for (const table of ["failover_order", "key_order", "key_marks", "failover_events", "failover_notices"]) legacy.exec(`DROP TABLE ${table}`);
    legacy.close();
    const reopened = f.reopen();
    assert.equal(reopened.failoverEnabled(), false);
    assert.equal(reopened.resolve(reopened.pin("deepgram")!), K1);
    assert.deepEqual(reopened.list()[0]!.keys[0]!.health, { exhausted: null, rejected: null });
    assert.deepEqual(reopened.notices(), []);
  } finally { f.cleanup(); }
});

test("failover: exhausted key moves to the next key of the same account, with audit, notice and no secret", async () => {
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Personal", [K1]);
    f.store.addKey(a, K2); // K2 is now the current key
    f.store.select(a); f.store.setFailover(true);
    f.behaviours.set(K2, refuse("deepgram", "exhausted", 402));
    f.behaviours.set(K1, completed("same-account"));

    const run = await f.job();
    assert.equal(run.status, "done"); assert.equal(run.stats?.succeeded, 1);
    assert.deepEqual(f.usedKeys(), [K2, K1]);
    assert.equal(f.health(a, K2), "exhausted"); assert.equal(f.health(a, K1), "ok");

    const notices = f.store.notices();
    assert.equal(notices.length, 1);
    const notice = notices[0]!;
    assert.equal(notice.kind, "moved"); assert.equal(notice.reason, "exhausted"); assert.equal(notice.status, 402);
    assert.equal(notice.from.accountId, a); assert.equal(notice.to?.accountId, a);
    assert.equal(notice.from.keyHint, `••••${K2.slice(-4)}`); assert.equal(notice.to?.keyHint, `••••${K1.slice(-4)}`);
    assert.equal(notice.serviceChanged, false); assert.equal(notice.count, 1);

    const moved = f.store.failoverEvents();
    assert.equal(moved.length, 1);
    assert.equal(moved[0]!.kind, "moved"); assert.equal(moved[0]!.workId, `run:${run.runId}`);
    assert.equal(moved[0]!.from.credentialId, f.keyId(a, K2)); assert.equal(moved[0]!.to?.credentialId, f.keyId(a, K1));
    assert.equal(f.store.workSelection(`run:${run.runId}`)?.pin?.credentialId, f.keyId(a, K1));
    const audit = f.auditRows().map((row) => row.action);
    assert.ok(audit.includes("health_exhausted")); assert.ok(audit.includes("failover_moved")); assert.ok(audit.includes("failover_on"));

    // The refused request was never accepted, so the same reservation served the retry.
    const usage = await f.ledger.snapshot();
    assert.equal(usage.last30d.audioMinutes, 2); assert.equal(usage.last30d.reservations, 1);
    assert.equal(usage.failedReservations, 0); assert.equal(usage.pendingReservations, 0);

    assertNoSecret("notices", notices); assertNoSecret("events", moved); assertNoSecret("audit", f.auditRows());
    assertNoSecret("account listing", f.store.list()); assertNoSecret("failover state", f.store.failoverState("deepgram"));
    assertNoSecret("run records", f.manager.listRuns()); assertNoSecret("pipeline events", f.events);
    assertNoSecret("private database", f.privateBytes());
  } finally { f.cleanup(); }
});

test("failover: exhausted keys are skipped for new work until re-enabled or re-checked", async () => {
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Personal", [K1]); f.store.addKey(a, K2);
    const b = f.store.create("deepgram", "Work", [K3]);
    f.store.select(a); f.store.setFailoverOrder([b]); f.store.setFailover(true);
    const k1 = f.keyId(a, K1); const k2 = f.keyId(a, K2); const k3 = f.keyId(b, K3);
    const pinOf = (credentialId: string): CredentialPin => ({ provider: "deepgram", accountId: credentialId === k3 ? b : a, credentialId });

    f.store.recordRefusal({ pin: pinOf(k2), kind: "exhausted", status: 402, workIds: [] });
    assert.equal(f.store.pin("deepgram")?.credentialId, k2, "the operator's own selection is never rewritten");
    assert.equal(f.store.pinForNewWork("deepgram", "run:new-1")?.credentialId, k1);
    assert.equal(f.store.failoverState("deepgram").effective?.credentialId, k1);
    assert.equal(f.store.failoverEvents()[0]!.kind, "admitted");
    assert.equal(f.store.notices()[0]!.count, 2, "a skipped admission is told to the operator, on the same notice");

    // Dismissing a notice never silences the next automatic change, even an identical one.
    const dismissed = f.store.notices()[0]!.id;
    f.store.dismissNotice(dismissed);
    assert.deepEqual(f.store.notices(), []);
    assert.equal(f.store.pinForNewWork("deepgram", "run:new-2")?.credentialId, k1);
    const again = f.store.notices();
    assert.equal(again.length, 1); assert.notEqual(again[0]!.id, dismissed);
    assert.equal(again[0]!.count, 1); assert.equal(again[0]!.to?.keyHint, `••••${K1.slice(-4)}`);
    assert.equal(f.store.pinForNewWork("deepgram", "run:new-3")?.credentialId, k1);
    assert.equal(f.store.notices().length, 1); assert.equal(f.store.notices()[0]!.count, 2, "pending repeats share one notice");
    assert.deepEqual(f.store.failoverEvents().slice(0, 3).map((event) => [event.kind, event.workId]),
      [["admitted", "run:new-3"], ["admitted", "run:new-2"], ["admitted", "run:new-1"]]);

    // An access check proves authentication only: it never clears "exhausted".
    f.store.recordCheck(pinOf(k2), { state: "accepted", checkedAt: new Date().toISOString() });
    assert.equal(f.health(a, K2), "exhausted");
    assert.equal(f.store.pinForNewWork("deepgram")?.credentialId, k1);

    // A rejected access check is a definitive answer; an accepted one clears it again.
    f.store.recordCheck(pinOf(k1), { state: "rejected", checkedAt: new Date().toISOString() });
    assert.equal(f.health(a, K1), "rejected");
    assert.equal(f.store.pinForNewWork("deepgram")?.credentialId, k3, "next account once every key of this one is unhealthy");
    assert.equal(f.store.notices().filter((notice) => notice.to?.accountId === b).length, 1, "work sent to another account is announced");
    f.store.recordCheck(pinOf(k1), { state: "accepted", checkedAt: new Date().toISOString() });
    assert.equal(f.health(a, K1), "ok");
    assert.equal(f.store.pinForNewWork("deepgram")?.credentialId, k1);

    // The operator re-enables the exhausted key after topping up.
    f.store.resetKeyHealth(a, k2);
    assert.equal(f.health(a, K2), "ok");
    assert.equal(f.store.pinForNewWork("deepgram")?.credentialId, k2);

    // A key that fails again after being re-enabled is announced again.
    f.store.recordRefusal({ pin: pinOf(k2), kind: "rejected", status: 401, workIds: [] });
    assert.equal(f.store.notices().filter((notice) => notice.from.keyHint.endsWith(K2.slice(-4)) && notice.reason === "rejected").length, 1);

    // The mark is latched: a completed transcription never clears it, not even
    // one made with that very key while the switch is off.
    f.store.setFailover(false);
    f.behaviours.set(K2, completed("still-marked"));
    const done = await f.job();
    assert.equal(done.stats?.succeeded, 1); assert.equal(f.usedKeys().at(-1), K2);
    assert.equal(f.health(a, K2), "rejected");
    f.store.setFailover(true);
    assert.equal(f.store.pinForNewWork("deepgram")?.credentialId, k1, "still skipped once the switch is back on");
    // Only the operator clears it: a successful re-check for "rejected", or his reset.
    f.store.recordCheck(pinOf(k2), { state: "accepted", checkedAt: new Date().toISOString() });
    assert.equal(f.health(a, K2), "ok");
    assert.equal(f.store.pinForNewWork("deepgram")?.credentialId, k2);

    // A cancelled job still records the provider's answer, but decides nothing.
    const before = f.store.failoverEvents().length; const pendingBefore = JSON.stringify(f.store.notices());
    assert.deepEqual(f.store.recordRefusal({ pin: pinOf(k2), kind: "exhausted", status: 402, workIds: ["run:cancelled"], recordOnly: true }),
      { moved: false, reason: "record_only" });
    assert.equal(f.health(a, K2), "exhausted");
    assert.equal(f.store.failoverEvents().length, before); assert.equal(JSON.stringify(f.store.notices()), pendingBefore);
  } finally { f.cleanup(); }
});

test("failover: moves to the next listed account only after every key is refused; unlisted accounts are never used", async () => {
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Personal", [K1]); f.store.addKey(a, K2);
    const b = f.store.create("deepgram", "Work", [K3]);
    const unlisted = f.store.create("deepgram", "Not in the list", [K4]);
    f.store.select(a); f.store.setFailoverOrder([b]); f.store.setFailover(true);
    f.behaviours.set(K2, refuse("deepgram", "exhausted", 402));
    f.behaviours.set(K1, refuse("deepgram", "rejected", 401));
    f.behaviours.set(K3, completed("next-account"));

    const run = await f.job();
    assert.equal(run.status, "done");
    assert.deepEqual(f.usedKeys(), [K2, K1, K3]);
    assert.equal(f.store.workSelection(`run:${run.runId}`)?.pin?.accountId, b);
    const notices = f.store.notices();
    assert.equal(notices.length, 2);
    const toWork = notices.find((notice) => notice.to?.accountId === b)!;
    assert.equal(toWork.reason, "rejected"); assert.equal(toWork.from.label, "Personal"); assert.equal(toWork.to?.label, "Work");
    assert.equal(toWork.serviceChanged, false);

    // Nothing left in the operator's list: fail closed with a clear reason and tell him.
    f.behaviours.set(K3, refuse("deepgram", "exhausted", 402));
    const blocked = await f.job();
    assert.equal(blocked.status, "error");
    assert.match(blocked.error ?? "", /no other enabled, healthy key or account is left/);
    assert.match(blocked.error ?? "", /deepgram refused the request \(exhausted, HTTP 402\)/);
    assert.equal((blocked.error ?? "").includes("Original error"), false, "no text of the causing error is copied");
    assert.equal(f.usedKeys().includes(K4), false, "an account outside the list must never take over");
    assert.equal(f.health(unlisted, K4), "ok");
    assert.ok(f.store.notices().some((notice) => notice.kind === "blocked" && notice.to === null));
    assert.equal(f.store.failoverState("deepgram").blocked, true);
    assert.throws(() => f.manager.createRun(f.request()), /no_healthy_account_available/);
    assertNoSecret("blocked run", blocked); assertNoSecret("notices", f.store.notices());

    // Disabled accounts and locally revoked keys are skipped, never revived.
    f.store.resetKeyHealth(b, f.keyId(b, K3)); f.store.enable(b, false);
    assert.throws(() => f.store.pinForNewWork("deepgram"), /no_healthy_account_available/);
    f.store.enable(b, true); f.store.revoke(b, f.keyId(b, K3));
    assert.throws(() => f.store.pinForNewWork("deepgram"), /no_healthy_account_available/);
  } finally { f.cleanup(); }
});

test("failover: a move to another service is recorded as such and the transcript names the service that did the work", async () => {
  const f = fixture(policy({ ratesUsdPerHour: { assemblyai: 3, deepgram: 1, openai_whisper: 1 } }));
  try {
    const a = f.store.create("deepgram", "Deepgram personal", [K1]);
    const b = f.store.create("assemblyai", "AssemblyAI personal", [K3]);
    f.store.select(a); f.store.setFailoverOrder([b]); f.store.setFailover(true);
    f.behaviours.set(K1, refuse("deepgram", "rejected", 401));
    f.behaviours.set(K3, completed("other-service"));

    const run = await f.job();
    assert.equal(run.status, "done");
    assert.deepEqual(f.calls, [{ provider: "deepgram", key: K1 }, { provider: "assemblyai", key: K3 }]);
    const notice = f.store.notices()[0]!;
    assert.equal(notice.serviceChanged, true);
    assert.equal(notice.from.provider, "deepgram"); assert.equal(notice.to?.provider, "assemblyai");
    assert.equal(f.store.failoverEvents()[0]!.serviceChanged, true);
    assert.equal(f.store.workSelection(`run:${run.runId}`)?.provider, "assemblyai");

    const transcripts = await new TranscriptStore(f.config.outputDir).listAll();
    assert.equal(transcripts.length, 1);
    assert.equal(transcripts[0]!.record.transcription.provider, "assemblyai", "the record names the service that produced it");

    // The refused Deepgram reservation is released; the work is costed at the new service's rate.
    const usage = await f.ledger.snapshot();
    const by = (provider: SttProviderId) => usage.last30d.byProvider.find((row) => row.provider === provider)!;
    assert.equal(by("deepgram").reservations, 0);
    assert.equal(by("assemblyai").audioMinutes, 2); assert.equal(by("assemblyai").estimatedUsd, 0.1);
    assert.equal(usage.failedReservations, 0);
  } finally { f.cleanup(); }
});

test("failover: usage caps still apply to the service that takes over", async () => {
  // 2 minutes cost 0.033 USD at Deepgram and 0.1 USD at the fallback: only the first fits the cap.
  const f = fixture(policy({ maxTotalUsd30d: 0.05, ratesUsdPerHour: { assemblyai: 3, deepgram: 1, openai_whisper: 1 } }));
  try {
    const a = f.store.create("deepgram", "Deepgram personal", [K1]);
    const b = f.store.create("assemblyai", "AssemblyAI personal", [K3]);
    f.store.select(a); f.store.setFailoverOrder([b]); f.store.setFailover(true);
    f.behaviours.set(K1, refuse("deepgram", "exhausted", 402));
    f.behaviours.set(K3, completed("must-not-run"));

    const run = await f.job();
    assert.equal(run.status, "error");
    assert.match(run.error ?? "", /Usage limit exceeded: usd_30d/);
    assert.deepEqual(f.usedKeys(), [K1], "the cap blocks the fallback before any audio is sent");
    assert.equal((await f.ledger.snapshot()).last30d.reservations, 0);
    assert.equal(f.ledger.policy.maxTotalUsd30d, 0.05, "failover never raises a cap");
  } finally { f.cleanup(); }
});

test("failover: no move on timeout, network error, 5xx, rate limit or any failure after acceptance", async () => {
  const cases: Array<[string, Error]> = [
    ["timeout", new Error("Deepgram request timed out")],
    ["network", new TypeError("fetch failed")],
    ["5xx", new ProviderHttpError("Deepgram", 503)],
    ["rate limit", new ProviderHttpError("Deepgram", 429)],
    ["typed timeout", new ProviderError({ provider: "Deepgram", category: "timeout" })],
    ["typed network", new ProviderError({ provider: "Deepgram", category: "network" })],
    ["accepted but unreadable answer", new ProviderError({ provider: "Deepgram", category: "invalid-response", status: 200 })],
    ["post-acceptance provider error", new ProviderHttpError("AssemblyAI", 401)],
    ["post-acceptance credit wording", new InsufficientCreditsError("AssemblyAI", 402)],
    ["job ended in error", new ProviderError({ provider: "AssemblyAI", category: "transcription-failed", token: "job-1" })],
    ["poll timeout", new Error("Transcription timed out after 60 minutes; upstream job job-1 was not recreated")],
  ];
  for (const [name, error] of cases) {
    const f = fixture();
    try {
      const a = f.store.create("deepgram", "Personal", [K1]); f.store.addKey(a, K2);
      const b = f.store.create("deepgram", "Work", [K3]);
      f.store.select(a); f.store.setFailoverOrder([b]); f.store.setFailover(true);
      f.behaviours.set(K2, fail(error));
      f.behaviours.set(K1, completed("must-not-run")); f.behaviours.set(K3, completed("must-not-run"));

      const run = await f.job();
      assert.deepEqual(f.usedKeys(), [K2], `${name}: the audio must not be sent to another key or account`);
      assert.notEqual(run.stats?.succeeded, 1, `${name}: the job fails as before`);
      assert.equal(f.health(a, K2), "ok", `${name}: health changes only on a definitive refusal`);
      assert.deepEqual(f.store.notices(), [], name); assert.deepEqual(f.store.failoverEvents(), [], name);
      assert.equal(f.store.pinForNewWork("deepgram")?.credentialId, f.keyId(a, K2), name);
      assert.equal((await f.ledger.snapshot()).failedReservations, 1, `${name}: possibly billable work stays in the ledger`);
    } finally { f.cleanup(); }
  }
});

test("failover: with the switch off a definitive refusal fails exactly like an unpinned run", async () => {
  const refusalMessage = "deepgram error: payment-or-quota (HTTP 402)";
  // Reference: the same pipeline without any account registry.
  const reference = fixture();
  let expected: { errors: string[]; done: PipelineEvent[]; failed: number; minutes: number };
  try {
    const events: PipelineEvent[] = [];
    await runPipeline({ kind: "audio", audioId: "audio-1", audioPath: reference.source },
      { ...reference.config, deepgramApiKey: K2 }, { force: false, runId: "reference", emitter: { emit: (event) => events.push(event) },
        deps: { ...reference.deps, createTranscriptionProvider: () => ({ name: "deepgram", getCapabilities: () => ({ supportsDiarization: true }),
          transcribe: async () => refuse("deepgram", "exhausted", 402)() }) } });
    const usage = await reference.ledger.snapshot();
    expected = { errors: events.flatMap((event) => event.type === "video:error" ? [event.error] : []),
      done: events.filter((event) => event.type === "run:done"), failed: usage.failedReservations, minutes: usage.last30d.audioMinutes };
    assert.deepEqual(expected.errors, [refusalMessage]);
  } finally { reference.cleanup(); }

  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Personal", [K1]); f.store.addKey(a, K2);
    const b = f.store.create("deepgram", "Work", [K3]);
    f.store.select(a); f.store.setFailoverOrder([b]); // list prepared, switch never turned on
    f.behaviours.set(K2, refuse("deepgram", "exhausted", 402));
    f.behaviours.set(K1, completed("must-not-run")); f.behaviours.set(K3, completed("must-not-run"));
    const before = f.store.pin("deepgram");

    const run = await f.job();
    assert.deepEqual(f.usedKeys(), [K2]);
    assert.equal(run.status, "done"); assert.deepEqual(run.stats, { succeeded: 0, failed: 1, skipped: 0, total: 1 });
    assert.deepEqual(f.events.flatMap((event) => event.type === "video:error" ? [event.error] : []), expected.errors);
    assert.equal(f.events.filter((event) => event.type === "run:done").length, expected.done.length);
    const usage = await f.ledger.snapshot();
    assert.equal(usage.failedReservations, expected.failed); assert.equal(usage.last30d.audioMinutes, expected.minutes);

    assert.deepEqual(f.store.notices(), []); assert.deepEqual(f.store.failoverEvents(), []);
    assert.deepEqual(f.store.workSelection(`run:${run.runId}`)?.pin, before);
    assert.deepEqual(f.store.pin("deepgram"), before);
    assert.deepEqual(f.store.pinForNewWork("deepgram"), before, "an unhealthy mark is informative only while the switch is off");
    assert.equal(f.health(a, K2), "exhausted", "the definitive answer is still shown to the operator");
    const again = await f.job();
    assert.deepEqual(f.usedKeys(), [K2, K2]); assert.equal(again.stats?.failed, 1);
  } finally { f.cleanup(); }
});

test("failover: pinned in-flight work is never re-pinned silently", async () => {
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Personal", [K1]); f.store.addKey(a, K2);
    const b = f.store.create("deepgram", "Work", [K3]);
    f.store.select(a); f.store.setFailover(true);
    const k1 = f.keyId(a, K1); const k2 = f.keyId(a, K2);
    const firstRequest = { ...f.request(), intakeId: "int_synthetic" }; const secondRequest = f.request();
    f.store.recordWork("intake:int_synthetic", "deepgram", f.store.pin("deepgram"));
    const first = f.manager.createRun(firstRequest); const second = f.manager.createRun(secondRequest);
    const pinned = () => f.store.workSelection(`run:${second.runId}`)?.pin?.credentialId;
    assert.equal(pinned(), k2);

    f.behaviours.set(K2, refuse("deepgram", "exhausted", 402)); f.behaviours.set(K1, completed("moved"));
    await f.start(first, firstRequest);
    assert.equal(f.store.workSelection(`run:${first.runId}`)?.pin?.credentialId, k1);
    assert.equal(f.store.workSelection("intake:int_synthetic")?.pin?.credentialId, k1, "a restart must not replay the refused key");
    assert.equal(pinned(), k2, "work that did not hit the refusal keeps its accepted pin");

    // Operator configuration changes do not touch accepted work either.
    f.store.setFailoverOrder([b]); f.store.setKeyOrder(a, [k1, k2]); f.store.setFailover(false); f.store.setFailover(true);
    assert.equal(pinned(), k2);

    // The queued run still asks its own pinned key, and its move is recorded for that run.
    const finished = await f.start(second, secondRequest);
    assert.equal(finished.status, "done");
    assert.deepEqual(f.usedKeys(), [K2, K1, K2, K1]);
    assert.equal(pinned(), k1);
    const moved = f.store.failoverEvents().filter((event) => event.kind === "moved");
    assert.deepEqual(moved.map((event) => event.workId).sort(), [`run:${first.runId}`, `run:${second.runId}`].sort());
    assert.equal(f.store.notices().length, 1); assert.equal(f.store.notices()[0]!.count, 2);

    // Local revocation follows the moved pin.
    const third = f.request(); const queued = f.manager.createRun(third);
    assert.equal(f.store.workSelection(`run:${queued.runId}`)?.pin?.credentialId, k1);
    f.store.revoke(a, k1);
    assert.equal(f.manager.revokeCredential(k1), 1);
    assert.equal(f.manager.getRun(queued.runId)?.status, "cancelled");
  } finally { f.cleanup(); }
});

test("failover: a split recording continues on the same service but never changes service part-way", async () => {
  // Same service: the refused piece moves to the next key; accepted pieces are kept and not paid twice.
  const same = fixture(policy(), { maxAudioBytes: 4 });
  try {
    const a = same.store.create("deepgram", "Personal", [K1]); same.store.addKey(a, K2);
    same.store.select(a); same.store.setFailover(true);
    let k2Calls = 0;
    same.behaviours.set(K2, () => { k2Calls += 1; if (k2Calls > 1) return refuse("deepgram", "exhausted", 402)(); return completed("piece-1")(); });
    same.behaviours.set(K1, completed("piece-2"));
    const run = await same.job();
    assert.equal(run.status, "done"); assert.equal(run.stats?.succeeded, 1);
    assert.deepEqual(same.usedKeys(), [K2, K2, K1]);
    const usage = await same.ledger.snapshot();
    assert.equal(usage.last30d.reservations, 2); assert.equal(usage.failedReservations, 0);
  } finally { same.cleanup(); }

  // Other service after a piece was accepted: the recording stops. Nothing is
  // moved or rewritten for it, and the notice says it stopped, not that another
  // account took over.
  const other = fixture(policy(), { maxAudioBytes: 4 });
  try {
    const a = other.store.create("deepgram", "Deepgram personal", [K1]);
    const b = other.store.create("assemblyai", "AssemblyAI personal", [K3]);
    other.store.select(a); other.store.setFailoverOrder([b]); other.store.setFailover(true);
    const k1 = other.keyId(a, K1);
    let k1Calls = 0;
    other.behaviours.set(K1, () => { k1Calls += 1; if (k1Calls > 1) return refuse("deepgram", "exhausted", 402)(); return completed("piece-1")(); });
    other.behaviours.set(K3, completed("other-service"));
    const run = await other.job();
    assert.equal(run.stats?.failed, 1);
    assert.deepEqual(other.usedKeys(), [K1, K1], "the fallback service receives nothing from a half-accepted recording");
    const error = other.events.flatMap((event) => event.type === "video:error" ? [event.error] : [])[0] ?? "";
    assert.match(error, /^Recording stopped: deepgram refused the request \(exhausted, HTTP 402\) after part of this recording was already accepted by deepgram, and the next account uses assemblyai/);
    assert.match(error, /not re-sent automatically/);
    assert.match(error, /Transcribing it again with assemblyai repeats the parts already done, and those parts can be charged again\.$/);

    assert.equal(other.health(a, K1), "exhausted", "the refusal itself is always recorded");
    const stoppedEvents = other.store.failoverEvents();
    assert.deepEqual(stoppedEvents.map((event) => event.kind), ["recording_stopped"], "a distinct transition, and no move");
    assert.equal(stoppedEvents[0]!.workId, `run:${run.runId}`); assert.equal(stoppedEvents[0]!.serviceChanged, false);
    assert.deepEqual(other.store.workSelection(`run:${run.runId}`),
      { provider: "deepgram", pin: { provider: "deepgram", accountId: a, credentialId: k1 } }, "the recording keeps its real provider pin");
    const stopped = other.store.notices();
    assert.equal(stopped.length, 1);
    assert.equal(stopped[0]!.kind, "stopped"); assert.equal(stopped[0]!.serviceChanged, false);
    assert.equal(stopped[0]!.from.accountId, a); assert.equal(stopped[0]!.to?.accountId, b);
    assert.ok(other.auditRows().some((row) => row.action === "failover_recording_stopped"));
    assert.equal(other.auditRows().some((row) => row.action === "failover_moved"), false);
    const usage = await other.ledger.snapshot();
    assert.equal(usage.last30d.reservations, 1, "only the accepted piece stays in the ledger");
    assert.equal((await new TranscriptStore(other.config.outputDir).listAll()).length, 0);

    // New work is a different matter: it does move, and that is announced as a move.
    const next = await other.job();
    assert.equal(next.stats?.succeeded, 1);
    assert.deepEqual(other.usedKeys().slice(2), [K3, K3]);
    const moved = other.store.notices().find((notice) => notice.kind === "moved")!;
    assert.equal(moved.serviceChanged, true); assert.equal(moved.to?.accountId, b);
    assert.equal((await new TranscriptStore(other.config.outputDir).listAll())[0]!.record.transcription.provider, "assemblyai");
  } finally { other.cleanup(); }

  // Other service before anything was accepted: the whole recording is planned again for it.
  const fresh = fixture(policy(), { maxAudioBytes: 4 });
  try {
    const a = fresh.store.create("deepgram", "Deepgram personal", [K1]);
    const b = fresh.store.create("assemblyai", "AssemblyAI personal", [K3]);
    fresh.store.select(a); fresh.store.setFailoverOrder([b]); fresh.store.setFailover(true);
    fresh.behaviours.set(K1, refuse("deepgram", "exhausted", 402)); fresh.behaviours.set(K3, completed("piece"));
    const run = await fresh.job();
    assert.equal(run.status, "done"); assert.equal(run.stats?.succeeded, 1);
    assert.deepEqual(fresh.usedKeys(), [K1, K3, K3]);
    const usage = await fresh.ledger.snapshot();
    assert.equal(usage.last30d.byProvider.find((row) => row.provider === "deepgram")!.reservations, 0);
    assert.equal(usage.last30d.byProvider.find((row) => row.provider === "assemblyai")!.reservations, 2);
    assert.equal((await new TranscriptStore(fresh.config.outputDir).listAll())[0]!.record.transcription.provider, "assemblyai");
  } finally { fresh.cleanup(); }
});

test("failover: each attempt keeps its own pin for guards and revocation while a sibling recording moves the run", async () => {
  const firstStarted = deferred(); const release = deferred();
  let guardError: unknown; let cancelled = -1; let account = ""; let k1 = ""; let k2 = "";
  let pinDuringUpload: string | undefined; let outstandingAfter = -1;
  const f = fixture(policy(), {}, async (_input, effective, options) => {
    const session = createSttSession({ config: effective, providerFactory: f.deps.createTranscriptionProvider, failover: options.failover,
      assertCredentialAvailable: options.assertCredentialAvailable, abortSignal: options.abortSignal, isCancelled: () => false });
    const first = session.startItem(); const second = session.startItem();
    const uploading = first.transcribePiece("recording-1", pieceOptions, 0).catch((error) => { guardError = error; });
    await firstStarted.promise;
    // The second recording is refused with the same key and moves the run to the next one.
    await second.transcribePiece("recording-2", pieceOptions, 0);
    pinDuringUpload = options.failover!.credentialId();
    // The run's pin is now the second key, yet recording-1 is still uploading with the first.
    f.store.revoke(account, k1);
    cancelled = f.manager.revokeCredential(k1);
    release.resolve();
    await uploading;
    first.close(); second.close();
    outstandingAfter = f.manager.revokeCredential(k1);
  });
  try {
    account = f.store.create("deepgram", "Personal", [K2]); f.store.addKey(account, K1); // K1 is current
    f.store.select(account); f.store.setFailover(true);
    k1 = f.keyId(account, K1); k2 = f.keyId(account, K2);
    f.behaviours.set(K1, async ({ path, opts }) => {
      if (path !== "recording-1") return refuse("deepgram", "exhausted", 402)();
      firstStarted.resolve();
      await release.promise;
      // What every adapter does before its next request, retry or poll.
      opts.beforeRequest?.();
      return completed("recording-1")();
    });
    f.behaviours.set(K2, completed("recording-2"));

    const run = await f.job();
    assert.deepEqual(f.usedKeys(), [K1, K1, K2]);
    assert.equal(pinDuringUpload, k2, "the sibling moved the run");
    assert.equal(cancelled, 1, "revoking a key still in use by an outstanding upload cancels the run");
    assert.ok(guardError instanceof CredentialError, "the upload's own guard must see its own key, not the run's new one");
    assert.equal((guardError as CredentialError).code, "credential_revoked_local");
    assert.equal(run.status, "cancelled"); assert.equal(run.error, "credential_revoked_local");
    assert.equal(outstandingAfter, 0, "a finished attempt is no longer tracked");
    assert.equal(f.store.failoverEvents().filter((event) => event.kind === "moved").length, 1);
  } finally { f.cleanup(); }
});

test("failover: a recording that follows a sibling's move has its own audited, noticed transition, never across services part-way", async () => {
  // Same service: the second recording ends on the same key, and that is its own recorded transition.
  const outcomes: string[] = [];
  const same = fixture(policy(), {}, async (_input, effective, options) => {
    const session = createSttSession({ config: effective, providerFactory: same.deps.createTranscriptionProvider, failover: options.failover,
      assertCredentialAvailable: options.assertCredentialAvailable, abortSignal: options.abortSignal, isCancelled: () => false });
    const first = session.startItem(); const second = session.startItem();
    await first.transcribePiece("first", pieceOptions, 0);
    // The operator has seen and dismissed the notice of the first move.
    same.store.dismissNotice(same.store.notices()[0]!.id);
    await second.transcribePiece("second-piece-2", pieceOptions, 1);
    outcomes.push(second.engine().config.deepgramApiKey ?? "");
    first.close(); second.close();
  });
  try {
    const a = same.store.create("deepgram", "Personal", [K2]); same.store.addKey(a, K1);
    same.store.select(a); same.store.setFailover(true);
    same.behaviours.set(K1, refuse("deepgram", "exhausted", 402)); same.behaviours.set(K2, completed("ok"));
    const run = await same.job();
    assert.equal(run.status, "done");
    assert.deepEqual(same.usedKeys(), [K1, K2, K1, K2]); assert.deepEqual(outcomes, [K2]);
    assert.deepEqual(same.store.failoverEvents().map((event) => event.kind), ["moved", "moved"], "each recording's transition is audited");
    assert.equal(same.store.notices().length, 1, "the follow is announced although the first notice was dismissed");
    assert.equal(same.store.notices()[0]!.count, 1);
    assert.equal(same.health(a, K1), "exhausted"); assert.equal(same.health(a, K2), "ok");
  } finally { same.cleanup(); }

  // Other service: the sibling's move stands, but the partly transcribed recording stops.
  const errors: unknown[] = []; let stoppedProvider = "";
  const other = fixture(policy(), {}, async (_input, effective, options) => {
    const session = createSttSession({ config: effective, providerFactory: other.deps.createTranscriptionProvider, failover: options.failover,
      assertCredentialAvailable: options.assertCredentialAvailable, abortSignal: options.abortSignal, isCancelled: () => false });
    const first = session.startItem(); const second = session.startItem();
    await first.transcribePiece("first", pieceOptions, 0).catch((error) => errors.push(error));
    await second.transcribePiece("second-piece-2", pieceOptions, 1).catch((error) => errors.push(error));
    stoppedProvider = second.engine().config.sttProvider;
  });
  try {
    const a = other.store.create("deepgram", "Deepgram personal", [K1]);
    const b = other.store.create("assemblyai", "AssemblyAI personal", [K3]);
    other.store.select(a); other.store.setFailoverOrder([b]); other.store.setFailover(true);
    other.behaviours.set(K1, refuse("deepgram", "exhausted", 402)); other.behaviours.set(K3, completed("must-not-run"));
    const run = await other.job();
    assert.deepEqual(other.usedKeys(), [K1, K1], "nothing of the partly transcribed recording reaches the other service");
    assert.ok(errors[0] instanceof ServiceChangedSignal, "the first recording had nothing accepted and may be planned again");
    assert.ok(errors[1] instanceof RecordingStoppedError);
    assert.match((errors[1] as Error).message, /^Recording stopped: deepgram refused the request/);
    assert.equal(stoppedProvider, "deepgram", "the stopped recording keeps its own provider");
    assert.deepEqual(other.store.failoverEvents().map((event) => event.kind), ["recording_stopped", "moved"]);
    assert.deepEqual(other.store.notices().map((notice) => notice.kind).sort(), ["moved", "stopped"]);
    assert.equal(other.store.workSelection(`run:${run.runId}`)?.pin?.accountId, b, "the sibling's recorded move is not undone");
  } finally { other.cleanup(); }
});

test("failover: two jobs refused at the same moment each move once to the same next key", async () => {
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Personal", [K1]); f.store.addKey(a, K2); f.store.addKey(a, K3); // K3 is current
    f.store.select(a); f.store.setFailover(true);
    const k1 = f.keyId(a, K1); const k2 = f.keyId(a, K2); const k3 = f.keyId(a, K3);
    f.store.setKeyOrder(a, [k3, k2, k1]);
    let arrived = 0; const both = deferred();
    f.behaviours.set(K3, async () => { arrived += 1; if (arrived === 2) both.resolve(); await both.promise; return refuse("deepgram", "exhausted", 402)(); });
    f.behaviours.set(K2, completed("next-key")); f.behaviours.set(K1, completed("must-not-run"));

    const firstRequest = f.request(); const secondRequest = f.request();
    const first = f.manager.createRun(firstRequest); const second = f.manager.createRun(secondRequest);
    f.manager.startRun(first.runId, firstRequest); f.manager.startRun(second.runId, secondRequest);
    assert.equal(await f.manager.waitForIdle(30_000), true);

    for (const run of [first, second]) {
      assert.equal(f.manager.getRun(run.runId)?.stats?.succeeded, 1);
      assert.equal(f.store.workSelection(`run:${run.runId}`)?.pin?.credentialId, k2);
    }
    assert.deepEqual(f.usedKeys().sort(), [K2, K2, K3, K3], "no job skips past the next key");
    assert.equal(f.health(a, K3), "exhausted"); assert.equal(f.health(a, K2), "ok"); assert.equal(f.health(a, K1), "ok");
    const moved = f.store.failoverEvents();
    assert.deepEqual(moved.map((event) => [event.kind, event.from.credentialId, event.to?.credentialId]), [["moved", k3, k2], ["moved", k3, k2]]);
    assert.deepEqual(moved.map((event) => event.workId).sort(), [`run:${first.runId}`, `run:${second.runId}`].sort());
    assert.equal(f.store.notices().length, 1); assert.equal(f.store.notices()[0]!.count, 2);
  } finally { f.cleanup(); }
});

test("failover: a success of a request accepted before the refusal never clears the key's mark", async () => {
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Personal", [K2]); f.store.addKey(a, K1); // K1 is current
    f.store.select(a); f.store.setFailover(true);
    const k2 = f.keyId(a, K2);
    const firstAccepted = deferred(); const finishFirst = deferred(); let k1Calls = 0;
    f.behaviours.set(K1, async () => {
      k1Calls += 1;
      if (k1Calls > 1) return refuse("deepgram", "exhausted", 402)();
      firstAccepted.resolve(); await finishFirst.promise; return completed("accepted-earlier")();
    });
    f.behaviours.set(K2, completed("moved"));

    const olderRequest = f.request(); const older = f.manager.createRun(olderRequest);
    f.manager.startRun(older.runId, olderRequest);
    await firstAccepted.promise;
    const newerRequest = f.request(); const newer = f.manager.createRun(newerRequest);
    f.manager.startRun(newer.runId, newerRequest);
    await until(() => f.manager.getRun(newer.runId)?.status === "done", "the newer job to finish on the next key");
    assert.equal(f.health(a, K1), "exhausted");
    finishFirst.resolve();
    assert.equal(await f.manager.waitForIdle(30_000), true);

    assert.equal(f.manager.getRun(older.runId)?.stats?.succeeded, 1, "the older request completes with the key it was accepted on");
    assert.deepEqual(f.usedKeys(), [K1, K1, K2]);
    assert.equal(f.health(a, K1), "exhausted", "an older success must not erase the newer refusal");
    assert.equal(f.store.pinForNewWork("deepgram")?.credentialId, k2);
    assert.equal(f.auditRows().some((row) => row.action === "health_ok"), false);
  } finally { f.cleanup(); }
});

test("failover: every definitive refusal is recorded; the loop ends with the keys, not at a counter", async () => {
  const config = fixtureConfig();
  const provider = (): TranscriptionProvider => ({ name: "deepgram", getCapabilities: () => ({ supportsDiarization: true }),
    transcribe: async () => refuse("deepgram", "exhausted", 402)() });
  const session = (onRefusal: PipelineFailover["onDefinitiveRefusal"], cancelled = false) => {
    const tracked: string[] = [];
    return { tracked, item: createSttSession({ config, providerFactory: provider, isCancelled: () => cancelled, failover: {
      credentialId: () => "key-0", assertAvailable: () => undefined,
      track: (credentialId) => { tracked.push(`+${credentialId}`); return () => { tracked.push(`-${credentialId}`); }; },
      onDefinitiveRefusal: onRefusal } }).startItem() };
  };

  // Forty keys, far more than any fixed cap: each refusal is recorded, then the registry has nothing left.
  const recorded: string[] = []; const excluded: string[][] = [];
  const many = session(({ credentialId, refused }) => {
    recorded.push(credentialId); excluded.push(refused);
    const next = Number(credentialId.slice(4)) + 1;
    return next < 40 ? { moved: true, config, credentialId: `key-${next}` } : { moved: false, reason: "no_candidate" };
  });
  await assert.rejects(many.item.transcribePiece("piece", pieceOptions, 0), FailoverExhaustedError);
  assert.deepEqual(recorded, Array.from({ length: 40 }, (_unused, index) => `key-${index}`));
  assert.deepEqual(excluded[0], ["key-0"]); assert.deepEqual(excluded[2], ["key-0", "key-1", "key-2"]);
  assert.equal(excluded[39]!.length, 40, "the registry is always told every key this recording was refused with");
  many.item.close(); many.item.close();
  assert.equal(many.tracked.length, 80, "every key the recording owned was tracked and released exactly once");
  assert.equal(many.tracked.at(-1), "-key-39");
  for (let index = 0; index < 40; index += 1) {
    assert.equal(many.tracked.filter((entry) => entry === `+key-${index}`).length, 1);
    assert.equal(many.tracked.filter((entry) => entry === `-key-${index}`).length, 1);
  }

  // Defensive: a registry that ignores those exclusions and offers a refused key again is stopped, with its own reason.
  const repeated: string[] = [];
  const loop = session(({ credentialId }) => {
    repeated.push(credentialId);
    return { moved: true, config, credentialId: credentialId === "key-0" ? "key-1" : "key-0" };
  });
  await assert.rejects(loop.item.transcribePiece("piece", pieceOptions, 0), (error: unknown) => {
    assert.ok(error instanceof FailoverRepeatedCandidateError);
    assert.match(error.message, /the only key offered next had already been refused for this recording/);
    return true;
  });
  assert.deepEqual(repeated, ["key-0", "key-1"], "the second refusal is recorded before stopping");

  // A cancelled run records the answer but asks for no move, and fails with the provider's own error.
  const flags: boolean[] = [];
  const cancelled = session(({ recordOnly }) => { flags.push(recordOnly); return { moved: false, reason: "record_only" }; }, true);
  await assert.rejects(cancelled.item.transcribePiece("piece", pieceOptions, 0), ProviderRefusalError);
  assert.deepEqual(flags, [true]);

  // A partly accepted recording says so, and a refusal to move it has its own error.
  const partial: boolean[] = [];
  const stoppedItem = session(({ sameProviderOnly }) => { partial.push(sameProviderOnly); return { moved: false, reason: "recording_stopped", nextProvider: "assemblyai" }; });
  await assert.rejects(stoppedItem.item.transcribePiece("piece-3", pieceOptions, 2), RecordingStoppedError);
  assert.deepEqual(partial, [true]);
});

test("failover: exhaustion is its own latched fact; a later access refusal or accepted check never clears it", () => {
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Personal", [K2]); f.store.addKey(a, K1); // K1 is current
    f.store.select(a); f.store.setFailover(true);
    const k1 = f.keyId(a, K1); const k2 = f.keyId(a, K2);
    const pin: CredentialPin = { provider: "deepgram", accountId: a, credentialId: k1 };
    const check = (state: "accepted" | "rejected") => f.store.recordCheck(pin, { state, checkedAt: new Date().toISOString() });

    f.store.recordRefusal({ pin, kind: "exhausted", status: 402, workIds: [], recordOnly: true });
    const exhausted = f.marks(a, K1).exhausted;
    assert.equal(exhausted?.status, 402); assert.equal(f.marks(a, K1).rejected, null);

    // The exhausted key later gets an authentication refusal: both facts hold.
    f.store.recordRefusal({ pin, kind: "rejected", status: 401, workIds: [], recordOnly: true });
    assert.equal(f.health(a, K1), "exhausted+rejected");
    assert.deepEqual(f.marks(a, K1).exhausted, exhausted, "the access refusal does not replace or restart the exhaustion");
    assert.equal(f.marks(a, K1).rejected?.status, 401);

    // An accepted access check clears the access fact only. Credit is unchanged, so the key stays skipped.
    check("accepted");
    assert.equal(f.health(a, K1), "exhausted");
    assert.deepEqual(f.marks(a, K1).exhausted, exhausted);
    assert.equal(f.store.pinForNewWork("deepgram")?.credentialId, k2);
    check("rejected"); check("accepted"); check("accepted");
    assert.equal(f.health(a, K1), "exhausted");
    const actions = f.auditRows().map((row) => row.action);
    assert.equal(actions.filter((action) => action === "health_rejected_cleared").length, 2);
    assert.equal(actions.includes("health_exhausted_cleared"), false);

    // Only "mark as available" clears exhaustion.
    f.store.resetKeyHealth(a, k1);
    assert.equal(f.health(a, K1), "ok");
    assert.equal(f.store.pinForNewWork("deepgram")?.credentialId, k1);
    assert.ok(f.auditRows().some((row) => row.action === "health_exhausted_cleared"));
  } finally { f.cleanup(); }
});

test("failover: a sibling's destination is re-validated; an unhealthy one is not followed and the move is still announced", async () => {
  let k2 = ""; let account = ""; const destinations: string[] = [];
  const f = fixture(policy(), {}, async (_input, effective, options) => {
    const session = createSttSession({ config: effective, providerFactory: f.deps.createTranscriptionProvider, failover: options.failover,
      assertCredentialAvailable: options.assertCredentialAvailable, abortSignal: options.abortSignal, isCancelled: () => false });
    const first = session.startItem(); const second = session.startItem();
    // Recording A is refused on K1 and moves the run to K2.
    await first.transcribePiece("recording-a", pieceOptions, 0);
    destinations.push(first.engine().config.deepgramApiKey ?? "");
    // The operator dismisses that notice; then another run marks K2 exhausted.
    f.store.dismissNotice(f.store.notices()[0]!.id);
    f.store.recordRefusal({ pin: { provider: "deepgram", accountId: account, credentialId: k2 }, kind: "exhausted", status: 402,
      workIds: [], recordOnly: true });
    // Recording B, still on K1, is refused now.
    await second.transcribePiece("recording-b", pieceOptions, 0);
    destinations.push(second.engine().config.deepgramApiKey ?? "");
    first.close(); second.close();
  });
  try {
    account = f.store.create("deepgram", "Personal", [K3]); f.store.addKey(account, K2); f.store.addKey(account, K1); // K1 is current
    f.store.select(account); f.store.setFailover(true);
    const k1 = f.keyId(account, K1); k2 = f.keyId(account, K2); const k3 = f.keyId(account, K3);
    f.store.setKeyOrder(account, [k1, k2, k3]);
    f.behaviours.set(K1, refuse("deepgram", "exhausted", 402));
    f.behaviours.set(K2, ({ path }) => path === "recording-a" ? completed("a")() : completed("must-not-run")());
    f.behaviours.set(K3, completed("b"));

    const run = await f.job();
    assert.equal(run.status, "done");
    assert.deepEqual(f.usedKeys(), [K1, K2, K1, K3], "B must not be sent to the key that became exhausted");
    assert.deepEqual(destinations, [K2, K3]);
    assert.deepEqual(f.store.failoverEvents().map((event) => [event.kind, event.from.credentialId, event.to?.credentialId]),
      [["moved", k1, k3], ["moved", k1, k2]], "each recording's actual transition is audited");
    const pending = f.store.notices();
    assert.equal(pending.length, 1, "B's move is announced although A's notice was dismissed");
    assert.equal(pending[0]!.to?.keyHint, `••••${K3.slice(-4)}`);
    assert.equal(f.store.workSelection(`run:${run.runId}`)?.pin?.credentialId, k3);
  } finally { f.cleanup(); }
});

test("failover: a key re-enabled mid-recording is not handed back to the recording it refused", async () => {
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Personal", [K3]); f.store.addKey(a, K2); f.store.addKey(a, K1); // K1 is current
    f.store.select(a); f.store.setFailover(true);
    const k1 = f.keyId(a, K1); const k2 = f.keyId(a, K2); const k3 = f.keyId(a, K3);
    f.store.setKeyOrder(a, [k1, k2, k3]);
    f.behaviours.set(K1, refuse("deepgram", "exhausted", 402));
    // While the recording is on K2 the operator marks K1 as available again; then K2 is refused too.
    f.behaviours.set(K2, () => { f.store.resetKeyHealth(a, k1); return refuse("deepgram", "exhausted", 402)(); });
    f.behaviours.set(K3, completed("third-key"));

    const run = await f.job();
    assert.equal(run.stats?.succeeded, 1, "the healthy third key is tried instead of stopping");
    assert.deepEqual(f.usedKeys(), [K1, K2, K3]);
    assert.deepEqual(f.store.failoverEvents().map((event) => [event.kind, event.from.credentialId, event.to?.credentialId]),
      [["moved", k2, k3], ["moved", k1, k2]], "no move back to the re-enabled key is recorded");
    assert.equal(f.store.workSelection(`run:${run.runId}`)?.pin?.credentialId, k3);
    assert.equal(f.health(a, K1), "ok", "the operator's reset stands for new work");
    assert.equal(f.store.pinForNewWork("deepgram")?.credentialId, k1);
    // The store itself refuses to offer an excluded key, whatever its health.
    assert.deepEqual(f.store.recordRefusal({ pin: { provider: "deepgram", accountId: a, credentialId: k3 }, kind: "rejected", status: 401,
      workIds: [], exclude: [k1, k2, k3] }), { moved: false, reason: "no_candidate" });
  } finally { f.cleanup(); }
});

test("disclosure: no provider text and no key characters reach logs, run records, events, the audit trail or error texts", async () => {
  const BODY = "PROVIDER-FREE-TEXT";
  const echo = (key: string, code?: string) => JSON.stringify({ err_code: code,
    err_msg: `${BODY} for key ${key.slice(0, 8)}****${key.slice(-4)} and ****${key.slice(-4)}`, request_id: `${BODY}-${key.slice(-4)}` });
  // Two ways a provider could write a key and still look like a plain identifier: a fragment with a separator
  // ("QZ-X1" for a key ending "QZX1") and a whole key with a dot between its characters.
  const separated = (key: string) => `${key.slice(-4, -2)}-${key.slice(-2)}`;
  const dotted = (key: string) => [...key].join(".");
  const bare = (text: string) => text.replace(/[^A-Za-z0-9]/g, "");
  assert.equal(separated(K1), "QZ-X1");
  // What a key must never leave behind outside the authenticated accounts screen and its notice.
  const fragments = [K1, K2, K3].flatMap((key) => [key, key.slice(-4), key.slice(0, 4), key.slice(0, 8)]);
  const assertClean = (label: string, value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    for (const fragment of [...fragments, BODY]) assert.equal(text.includes(fragment), false, `${label} must not contain ${fragment}`);
    // Nor written with separators: the comparison is repeated with everything but letters and digits removed.
    for (const fragment of fragments) {
      assert.equal(bare(text).includes(bare(fragment)), false, `${label} must not contain ${fragment} in separated form`);
    }
  };

  // No string supplied by a provider leaves an adapter. A recognised code becomes this code base's own constant;
  // anything else the provider sends, whatever its shape, is the fixed label "other".
  assert.equal(fixedLabel(DEEPGRAM_ERROR_LABELS, "ASR_PAYMENT_REQUIRED"), "ASR_PAYMENT_REQUIRED");
  assert.equal(fixedLabel(OPENAI_ERROR_LABELS, "insufficient_quota"), "insufficient_quota");
  assert.equal(fixedLabel(OPENAI_ERROR_LABELS, "not_listed", "rate_limit_error"), "rate_limit_error", "the first recognised candidate");
  assert.equal(fixedLabel(DEEPGRAM_ERROR_LABELS, undefined, null), undefined, "no code sent, no label");
  const key32 = "Nb4WxQ7LpZ2VtK9RcJ5HmD8GsY3FgB6T";
  assert.equal(key32.length, 32); assert.equal(dotted(key32).length, 63, "a dotted 32-character key fits in 64 characters");
  for (const sent of ["Bad Request", "", 42, { code: "x" }, "invalid_api_key", `CODE_${K1.slice(-4)}`, separated(K1), dotted(key32), key32, K1]) {
    assert.equal(fixedLabel(DEEPGRAM_ERROR_LABELS, sent), "other", `a provider string is never passed on: ${JSON.stringify(sent)}`);
  }
  for (const label of [...DEEPGRAM_ERROR_LABELS, ...OPENAI_ERROR_LABELS]) assert.match(label, /^[A-Za-z_]+$/, "labels are plain words of this code base");

  const f = fixture(policy(), {}, undefined, (config) => new DeepgramProvider(config.deepgramApiKey ?? "", "nova-3", true, undefined, 1000));
  try {
    const a = f.store.create("deepgram", "Cuenta personal", [K2]); f.store.addKey(a, K1); // K1 is current
    const b = f.store.create("deepgram", "Cuenta de respaldo", [K3]);
    f.store.select(a); f.store.setFailoverOrder([b]); f.store.setFailover(true);
    const answers = new Map<string, () => Response>([
      [K1, () => new Response(echo(K1, "ASR_PAYMENT_REQUIRED"), { status: 402 })],
      [K2, () => new Response(echo(K2, separated(K2)), { status: 401 })], // a "code" that is a key fragment with a separator
      [K3, () => new Response(echo(K3), { status: 500 })],
    ]);
    const deepgram = async (_url: string, init?: RequestInit) => {
      const key = String(new Headers(init?.headers).get("authorization")).replace("Token ", "");
      return answers.get(key)!();
    };
    const logs: string[] = [];
    const job = async () => { const run = await captureLogs(() => withFetch(deepgram, () => f.job())); logs.push(...run.lines); return run.result; };
    const lastError = () => f.events.flatMap((event) => event.type === "video:error" ? [event.error] : []).at(-1);

    // Two definitive refusals move the work twice; the third key fails on an older path: a server error.
    assert.equal((await job()).stats?.failed, 1);
    assert.equal(f.store.failoverEvents().filter((event) => event.kind === "moved").length, 2);
    assert.equal(lastError(), "Deepgram error: server-error (HTTP 500)");

    // The other older paths, each as its own job on the third key: fixed parts only, whatever the provider or the network says.
    const older: Array<[() => Response, string]> = [
      [() => new Response(echo(K3, "TOO_MANY_REQUESTS"), { status: 429 }), "Deepgram error: rate-limit (HTTP 429) [TOO_MANY_REQUESTS]"],
      [() => new Response(echo(K3, dotted(K3)), { status: 400 }), "Deepgram error: invalid-request (HTTP 400) [other]"],
      [() => new Response(echo(K3, `LEAK_${K3.slice(-4)}`), { status: 422 }), "Deepgram error: invalid-request (HTTP 422) [other]"],
      [() => new Response(echo(K3, "Bad Request"), { status: 418 }), "Deepgram error: invalid-request (HTTP 418) [other]"],
      [() => new Response(echo(K3), { status: 302 }), "Deepgram error: unclassified (HTTP 302)"],
      [() => new Response(`<html>${BODY} ${K3}</html>`, { status: 200 }), "Deepgram error: invalid-response (HTTP 200)"],
      [() => { throw new TypeError(`fetch failed for ${K3} ${BODY}`); }, "Deepgram error: network"],
      [() => { throw Object.assign(new Error(`${BODY} ${K3}`), { name: "AbortError" }); }, "Deepgram error: timeout"],
    ];
    for (const [answer, expected] of older) {
      answers.set(K3, answer);
      assert.equal((await job()).stats?.failed, 1);
      assert.equal(lastError(), expected);
    }

    // Nothing is left once the third key is refused as well.
    answers.set(K3, () => new Response(echo(K3, "ASR_PAYMENT_REQUIRED"), { status: 402 }));
    const blocked = await job();
    assert.equal(blocked.error, "Automatic account change stopped: deepgram refused the request (exhausted, HTTP 402) " +
      "and no other enabled, healthy key or account is left.");

    // With the switch off nothing moves, so the refusal itself becomes the job error.
    f.store.setFailover(false);
    answers.set(K1, () => new Response(echo(K1, "INVALID_AUTH"), { status: 401 }));
    assert.equal((await job()).stats?.failed, 1);
    assert.equal(lastError(), "Deepgram error: authentication (HTTP 401) [INVALID_AUTH]");
    assert.ok(logs.some((line) => line.includes("Deepgram error: authentication (HTTP 401) [INVALID_AUTH]")));
    // The same refusal carrying a separated key fragment as its "code": the label is the fixed word, nothing else.
    answers.set(K1, () => new Response(echo(K1, separated(K1)), { status: 401 }));
    assert.equal((await job()).stats?.failed, 1);
    assert.equal(lastError(), "Deepgram error: authentication (HTTP 401) [other]");
    assert.ok(logs.some((line) => line.includes("Automatic account change: deepgram refused the request (exhausted, HTTP 402)")));

    for (const [label, value] of [["logs", logs.join("\n")], ["run records", f.manager.listRuns()], ["pipeline events", f.events],
      ["audit trail, events and stored notices", f.storedTrail()], ["failover events", f.store.failoverEvents()]] as const) {
      assertClean(label, value);
    }
    // The one place a key hint is shown: the notice of the authenticated accounts screen, derived when it is rendered.
    const rendered = JSON.stringify(f.store.notices());
    assert.ok(rendered.includes(`••••${K1.slice(-4)}`) && rendered.includes(`••••${K3.slice(-4)}`));
    for (const key of [K1, K2, K3]) assert.equal(rendered.includes(key), false);
  } finally { f.cleanup(); }

  // AssemblyAI after acceptance (polling), with a secret shorter than eight characters.
  const short = "zq5T7";
  const clip = fixture();
  try {
    const drive = async (poll: () => Response, jobId: string) => {
      const run = await captureLogs(() => withFetch(async (url, init) => url.endsWith("/upload") ? Response.json({ upload_url: "https://cdn.assemblyai.test/u/1" })
        : init?.method === "POST" ? Response.json({ id: jobId, status: "queued" }) : poll(),
      async () => { try { await new AssemblyAiClient(short, 1000, 0).transcribe(clip.source, transcribeOptions); } catch (error) { return error as Error; } return undefined; }));
      return { message: run.result?.message ?? "", logs: run.lines.join("\n") };
    };
    const failed = "AssemblyAI error: transcription-failed; the accepted job ended in error at the provider";
    const outcomes = [
      [await drive(() => new Response(`Authentication error ${BODY} token ${short} is invalid`, { status: 401 }), "job-41"), "AssemblyAI error: authentication (HTTP 401)"],
      [await drive(() => new Response(JSON.stringify({ error: `${BODY} ${short}` }), { status: 503 }), "job-42"), "AssemblyAI error: server-error (HTTP 503)"],
      [await drive(() => Response.json({ id: "job-43", status: "error", error: `${BODY}: download failed for ${short}` }), "job-43"), failed],
      // The job identifier is the provider's string too. Plain, carrying the key, a separated fragment or a dotted key:
      // it is used to poll and never written to an error or a log line.
      [await drive(() => Response.json({ id: `job-${short}`, status: "error", error: BODY }), `job-${short}`), failed],
      [await drive(() => Response.json({ id: "zq-5T-7", status: "error", error: BODY }), "zq-5T-7"), failed],
      [await drive(() => Response.json({ id: dotted(short), status: "error", error: BODY }), dotted(short)), failed],
    ] as const;
    for (const [result, expected] of outcomes) {
      assert.equal(result.message, expected);
      for (const text of [result.message, result.logs]) {
        assert.equal(text.includes(BODY), false); assert.equal(text.includes(short), false);
        assert.equal(bare(text).toLowerCase().includes("zq5t"), false, "nor in separated form");
        assert.equal(/job-4\d/.test(text), false, "no upstream job identifier in an error or a log line");
      }
      assert.ok(result.logs.includes("Transcription started: AssemblyAI accepted the job"));
    }
  } finally { clip.cleanup(); }
});

test("failover: a selected account that cannot take work is reported as unavailable, never as the existing configuration", () => {
  const es = (spanish: string) => spanish;
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Cuenta personal", [K1]); f.store.select(a);
    const k1 = f.keyId(a, K1);
    assert.deepEqual(f.store.failoverState("deepgram").selection, { state: "selected", accountId: a });
    assert.deepEqual(f.store.noticesView("deepgram").routing,
      { enabled: false, state: "account", reason: null, provider: "deepgram", accountLabel: "Cuenta personal" });

    // The operator disables the selected account: new work is refused, and every view says so.
    f.store.enable(a, false);
    assert.throws(() => f.store.pinForNewWork("deepgram"), /selected_account_unavailable/);
    const disabled = f.store.failoverState("deepgram");
    assert.deepEqual(disabled.selection, { state: "unavailable", accountId: a, reason: "account_disabled" });
    assert.equal(disabled.effective, null); assert.equal(disabled.blocked, false);
    const routing = f.store.noticesView("deepgram").routing;
    assert.deepEqual(routing, { enabled: false, state: "unavailable", reason: "account_disabled", provider: "deepgram", accountLabel: "Cuenta personal" });
    assert.equal(routingRefusesNewWork(routing), true);
    const text = failoverRoutingText(routing, es);
    assert.match(text, /^Ahora mismo los trabajos nuevos se rechazan: la cuenta elegida, «Cuenta personal», está desactivada\./);
    assert.equal(text.includes("configuración existente"), false);

    // Its current key locally revoked: the same state with its own reason.
    f.store.enable(a, true); f.store.revoke(a, k1);
    assert.throws(() => f.store.pinForNewWork("deepgram"), /selected_account_unavailable/);
    assert.deepEqual(f.store.failoverState("deepgram").selection, { state: "unavailable", accountId: a, reason: "key_revoked" });
    assert.match(failoverRoutingText(f.store.noticesView("deepgram").routing, es), /la clave actual de la cuenta elegida, «Cuenta personal», está revocada localmente/);

    // Only a deliberate return to the existing configuration is shown as such.
    f.store.useLegacy("deepgram");
    assert.deepEqual(f.store.failoverState("deepgram").selection, { state: "legacy" });
    const legacy = f.store.noticesView("deepgram").routing;
    assert.deepEqual(legacy, { enabled: false, state: "legacy", reason: null, provider: "deepgram", accountLabel: null });
    assert.equal(routingRefusesNewWork(legacy), false);
    assert.match(failoverRoutingText(legacy, es), /usan la configuración existente de Deepgram/);
    assert.equal(f.store.pinForNewWork("deepgram"), undefined);
  } finally { f.cleanup(); }
});

test("screen order: the banner is told once, after the whole selection, also when it fails part-way or its answer is lost", async () => {
  type Snapshot = { accounts: string[] };
  const scenario = async (options: { post?: "refused" | "offline" | "unreadable" | "server_error"; activate?: boolean | "offline"; select?: boolean;
    reload?: false | "offline" }) => {
    const calls: string[] = [];
    const result = await runAccountAction<Snapshot>({
      post: async () => {
        calls.push("post");
        if (options.post === "offline") throw new Error("offline");
        // The server stored the change and answered, but the answer could not be read.
        if (options.post === "unreadable") throw new SyntaxError("Unexpected end of JSON input");
        if (options.post === "server_error") return { ok: false, status: 502, body: { accounts: [], error: "api_unreachable" } };
        return options.post === "refused" ? { ok: false, status: 403, body: { accounts: [], error: "recent_auth_required" } }
          : { ok: true, status: 200, body: { accounts: ["a"] } };
      },
      activateProvider: options.select === false ? undefined : async () => {
        calls.push("activate");
        if (options.activate === "offline") throw new Error("offline");
        return options.activate !== false;
      },
      reload: async () => { calls.push("reload"); if (options.reload === "offline") throw new Error("offline"); return options.reload !== false; },
      notifyChanged: () => { calls.push("notify"); },
    });
    return { calls, outcome: result.outcome };
  };
  // Selecting an account: both requests, the real state read back, and only then the banner.
  assert.deepEqual(await scenario({}), { calls: ["post", "activate", "reload", "notify"], outcome: "done" });
  // The account was selected but its provider could not be activated: say so, show the real state, then tell the banner.
  assert.deepEqual(await scenario({ activate: false }), { calls: ["post", "activate", "reload", "notify"], outcome: "provider_not_activated" });
  assert.deepEqual(await scenario({ activate: "offline" }), { calls: ["post", "activate", "reload", "notify"], outcome: "unreachable" });
  // The API said it changed nothing: the banner is not disturbed.
  assert.deepEqual(await scenario({ post: "refused" }), { calls: ["post"], outcome: "refused" });
  // Every other action is a single request.
  assert.deepEqual(await scenario({ select: false }), { calls: ["post", "notify"], outcome: "done" });

  // The answer to the change was lost: the server may have stored it. The change is sent once and never again;
  // the stored state is read back and shown, and the banner is told, so a switch that is on never shows as off.
  for (const post of ["offline", "unreadable", "server_error"] as const) {
    for (const select of [true, false]) {
      assert.deepEqual(await scenario({ post, select }), { calls: ["post", "reload", "notify"], outcome: "uncertain" }, `${post}, select ${select}`);
    }
    // The stored state cannot be read back either: say so, and still tell the banner to read its own state.
    assert.deepEqual(await scenario({ post, reload: false }), { calls: ["post", "reload", "notify"], outcome: "unreachable" });
    assert.deepEqual(await scenario({ post, reload: "offline" }), { calls: ["post", "reload", "notify"], outcome: "unreachable" });
  }
});

test("screen order: a read that began before a change never replaces what the change returned", () => {
  // The reviewer's scenario: a periodic read starts, the operator turns the switch on, the old read arrives last.
  const gate = createSnapshotGate();
  const staleRead = gate.beginRead();
  gate.changed();                       // the change starts
  const duringChange = gate.beginRead();
  gate.changed();                       // the change has answered: the switch is on
  assert.equal(gate.accepts(staleRead), false, "the read from before the change must not turn the switch off again");
  assert.equal(gate.accepts(duringChange), false, "a read that began while the change ran may also be older");
  const fresh = gate.beginRead();
  assert.equal(gate.accepts(fresh), true);
  // Two reads without a change in between: the older one must not overwrite the newer one.
  const older = gate.beginRead(); const newer = gate.beginRead();
  assert.equal(gate.accepts(newer), true); assert.equal(gate.accepts(older), false);
  // A failed change still invalidates the reads around it.
  const beforeFailure = gate.beginRead(); gate.changed(); gate.changed();
  assert.equal(gate.accepts(beforeFailure), false);
});

test("notice wording: past events in the past tense, current routing apart, and the cost of repeating a stopped recording", () => {
  const es = (spanish: string) => spanish; const en = (_spanish: string, english: string) => english;
  const from = { accountId: "a", label: "Cuenta personal", provider: "deepgram" as const, keyHint: "••••QZX1" };
  const notice = (over: Partial<FailoverNotice>): FailoverNotice => ({ id: "n", kind: "moved", reason: "exhausted", status: 402, from,
    to: { accountId: "b", label: "Cuenta de respaldo", provider: "assemblyai", keyHint: "••••HJK3" }, serviceChanged: true, count: 1,
    firstAt: "2026-11-12T10:00:00.000Z", lastAt: "2026-11-12T10:00:00.000Z", ...over });
  const present = [/ha dejado de usarse/, /deja de usarse/, /Ahora se usa/, /se usa ahora/, /is no longer used/, /is used now/];

  const moved = failoverNoticeText(notice({}), es);
  assert.match(moved, /^Deepgram rechazó una petición con la clave ••••QZX1 de la cuenta «Cuenta personal»: respondió que no quedaba saldo o cuota \(HTTP 402\)\./);
  assert.match(moved, /El trabajo afectado continuó con la cuenta «Cuenta de respaldo» \(AssemblyAI\), clave ••••HJK3\./);
  assert.match(moved, /El servicio de transcripción cambió de Deepgram a AssemblyAI: la calidad de esas transcripciones puede ser distinta\./);
  assert.match(moved, / Ocurrió el /);
  const sameAccount = failoverNoticeText(notice({ to: { ...from, keyHint: "••••WVY2" }, serviceChanged: false, reason: "rejected", status: 401, count: 3 }), es);
  assert.match(sameAccount, /rechazó peticiones .*: no aceptó la clave o su permiso \(HTTP 401\)\. Los trabajos afectados continuaron con la clave ••••WVY2 de la misma cuenta\. Ocurrió 3 veces/);
  assert.equal(sameAccount.includes("cambió de"), false);
  const blocked = failoverNoticeText(notice({ kind: "blocked", to: null, serviceChanged: false }), es);
  assert.match(blocked, /No quedaba ninguna otra clave o cuenta disponible en tu lista y el trabajo falló\./);

  const stopped = failoverNoticeText(notice({ kind: "stopped", serviceChanged: false }), es);
  assert.match(stopped, /Una grabación que ya estaba transcrita en parte se detuvo sin completarse/);
  assert.match(stopped, /Ninguna cuenta continuó esa grabación\./);
  assert.match(stopped, /Si la transcribes de nuevo, se repetirán también las partes que ya estaban hechas, y esas partes se te pueden cobrar otra vez\./);
  assert.equal(stopped.includes("continuó con"), false, "a stopped recording must not read as a takeover");
  assert.equal(failoverNoticeTitle(notice({ kind: "stopped" }), es), "Grabación detenida");
  assert.match(failoverNoticeText(notice({ kind: "stopped", serviceChanged: false }), en), /the parts that were already done are repeated too, and those parts can be charged again\./);

  for (const text of [moved, sameAccount, blocked, stopped, failoverNoticeText(notice({}), en)]) {
    for (const pattern of present) assert.equal(pattern.test(text), false, `a past event must not be told as the current state: ${pattern}`);
  }
  // Current routing is a separate sentence, in the present tense, without any key hint.
  const routing: FailoverRouting = { enabled: true, state: "account", reason: null, provider: "assemblyai", accountLabel: "Cuenta de respaldo" };
  assert.equal(failoverRoutingText(routing, es), "Ahora mismo los trabajos nuevos van a la cuenta «Cuenta de respaldo» (AssemblyAI).");
  assert.equal(failoverRoutingText({ ...routing, enabled: false, state: "legacy", accountLabel: null, provider: "deepgram" }, es),
    "Ahora mismo los trabajos nuevos usan la configuración existente de Deepgram. El cambio automático está desactivado.");
  assert.equal(failoverRoutingText({ ...routing, state: "blocked" }, es),
    "Ahora mismo los trabajos nuevos se rechazan: no queda ninguna clave o cuenta disponible en tu lista.");
  // A selected account that cannot take work is told as a refusal with its reason, never as the existing configuration.
  const disabled = failoverRoutingText({ ...routing, state: "unavailable", reason: "account_disabled", provider: "deepgram", accountLabel: "Cuenta personal" }, es);
  assert.equal(disabled, "Ahora mismo los trabajos nuevos se rechazan: la cuenta elegida, «Cuenta personal», está desactivada. " +
    "Actívala, elige otra clave o elige otra cuenta en Ajustes.");
  const revoked = failoverRoutingText({ ...routing, state: "unavailable", reason: "key_revoked", provider: "deepgram", accountLabel: "Cuenta personal" }, es);
  assert.match(revoked, /se rechazan: la clave actual de la cuenta elegida, «Cuenta personal», está revocada localmente\./);
  for (const text of [disabled, revoked]) assert.equal(text.includes("configuración existente"), false);
  assert.equal(routingRefusesNewWork({ ...routing, state: "unavailable", reason: "key_revoked" }), true);
  assert.equal(routingRefusesNewWork({ ...routing, state: "blocked" }), true);
  assert.equal(routingRefusesNewWork(routing), false); assert.equal(routingRefusesNewWork(undefined), false);
  assert.match(new RecordingStoppedError({ provider: "deepgram", kind: "exhausted", status: 402 }, "assemblyai").message,
    /repeats the parts already done, and those parts can be charged again\.$/);
});

test("failover: legacy environment keys and local disable never start an automatic move", async () => {
  const f = fixture();
  try {
    const b = f.store.create("deepgram", "Work", [K3]);
    f.store.setFailoverOrder([b]); f.store.setFailover(true);
    // No selected registry account: the provider runs on the existing configuration.
    assert.equal(f.store.pinForNewWork("deepgram"), undefined);
    assert.equal(f.store.failoverState("deepgram").effective, null);
    assert.equal(f.store.failoverState("deepgram").blocked, false);
    // A selected account the operator disabled still fails closed; that is not a provider refusal.
    const a = f.store.create("deepgram", "Personal", [K1]); f.store.select(a); f.store.enable(a, false);
    assert.throws(() => f.store.pinForNewWork("deepgram"), /selected_account_unavailable/);
    assert.deepEqual(f.store.failoverEvents(), []);
  } finally { f.cleanup(); }
});

test("failover: operator order is validated and survives a restart", () => {
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Personal", [K1]); f.store.addKey(a, K2);
    const b = f.store.create("assemblyai", "Other service", [K3]);
    const k1 = f.keyId(a, K1); const k2 = f.keyId(a, K2); const k3 = f.keyId(b, K3);
    f.store.setFailoverOrder([b, a]); f.store.setFailover(true);
    assert.deepEqual(f.store.failoverOrder(), [b, a]);
    assert.throws(() => f.store.setFailoverOrder([a, a]), /invalid_failover_order/);
    assert.throws(() => f.store.setFailoverOrder(["00000000-0000-4000-8000-000000000000"]), /account_not_found/);
    assert.throws(() => f.store.setKeyOrder(a, [k3]), /credential_unavailable/);
    assert.throws(() => f.store.setKeyOrder(a, [k1, k1]), /invalid_key_order/);
    assert.deepEqual(f.store.list().find((item) => item.id === a)!.keyOrder, [k2, k1], "current key first");
    f.store.useKey(a, k1);
    assert.deepEqual(f.store.list().find((item) => item.id === a)!.keyOrder, [k1, k2]);
    const reopened = f.reopen();
    assert.equal(reopened.failoverEnabled(), true); assert.deepEqual(reopened.failoverOrder(), [b, a]);
    assert.deepEqual(reopened.list().find((item) => item.id === a)!.keyOrder, [k1, k2]);
  } finally { f.cleanup(); }
});

async function withFetch<T>(handler: (url: string, init?: RequestInit) => Promise<Response>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = original; }
}
const transcribeOptions = { pollIntervalMs: 0, maxPollMinutes: 1, retries: 0, providerTimeoutMs: 1000 };
/**
 * Captures everything the application logs. Only stderr is intercepted: stdout
 * carries the test runner's own result stream, and swallowing it would hide a
 * test result. The logger sends its informational lines to stderr too while
 * Y2T_JSON_EVENTS is set, so nothing the application logs is missed.
 */
async function captureLogs<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const stderrWrite = process.stderr.write; const jsonEvents = process.env.Y2T_JSON_EVENTS;
  process.env.Y2T_JSON_EVENTS = "1";
  process.stderr.write = ((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try { return { result: await run(), lines }; }
  finally {
    process.stderr.write = stderrWrite;
    if (jsonEvents === undefined) delete process.env.Y2T_JSON_EVENTS; else process.env.Y2T_JSON_EVENTS = jsonEvents;
  }
}

test("typed errors: Deepgram refuses definitively only on documented 401, 402 and 403", async () => {
  const f = fixture();
  try {
    assert.equal(classifyDeepgramRefusal(401), "rejected"); assert.equal(classifyDeepgramRefusal(403), "rejected");
    assert.equal(classifyDeepgramRefusal(402), "exhausted");
    for (const status of [400, 404, 408, 413, 422, 429, 500, 502, 503, 504]) assert.equal(classifyDeepgramRefusal(status), undefined);
    const provider = new DeepgramProvider(K1, "nova-3", true, undefined, 1000);
    const attempt = (status: number, body: string) => withFetch(async (url, init) => {
      assert.match(url, /^https:\/\/api\.deepgram\.com\/v1\/listen\?/); assert.equal(init?.method, "POST");
      return new Response(body, { status });
    }, async () => { try { await provider.transcribe(f.source, transcribeOptions); } catch (error) { return error as Error; } throw new Error("expected a failure"); });

    const exhausted = await attempt(402, JSON.stringify({ err_code: "ASR_PAYMENT_REQUIRED", err_msg: `Project does not have enough credits ${K1}` }));
    assert.deepEqual(definitiveRefusalOf(exhausted), { provider: "deepgram", kind: "exhausted", status: 402 });
    assert.equal(exhausted.message, "Deepgram error: payment-or-quota (HTTP 402) [ASR_PAYMENT_REQUIRED]", "fixed parts and this code base's own label");
    const rejected = await attempt(401, '{"err_code":"INVALID_AUTH","err_msg":"Invalid credentials."}');
    assert.deepEqual(definitiveRefusalOf(rejected), { provider: "deepgram", kind: "rejected", status: 401 });
    assert.equal(rejected.message, "Deepgram error: authentication (HTTP 401) [INVALID_AUTH]");
    assert.equal(definitiveRefusalOf(await attempt(403, '{"err_code":"INSUFFICIENT_PERMISSIONS"}'))?.kind, "rejected");
    // Every other answer is a typed error with a fixed category, and never a refusal.
    for (const [status, category, text] of [[429, "rate-limit", "Deepgram error: rate-limit (HTTP 429) [TOO_MANY_REQUESTS]"],
      [500, "server-error", "Deepgram error: server-error (HTTP 500)"], [503, "server-error", "Deepgram error: server-error (HTTP 503)"],
      [404, "invalid-request", "Deepgram error: invalid-request (HTTP 404)"]] as const) {
      const error = await attempt(status, status === 429 ? '{"err_code":"TOO_MANY_REQUESTS","err_msg":"Too many requests."}' : "busy, please retry");
      assert.equal(definitiveRefusalOf(error), undefined);
      assert.ok(error instanceof ProviderHttpError); assert.equal(error.status, status); assert.equal(error.category, category);
      assert.equal(error.message, text);
    }
    const network = await withFetch(async () => { throw new TypeError("fetch failed: connect ECONNREFUSED 10.0.0.9:443"); },
      async () => { try { await provider.transcribe(f.source, transcribeOptions); } catch (error) { return error as Error; } return undefined; });
    assert.ok(network instanceof ProviderError); assert.equal(network.category, "network");
    assert.equal(network.message, "Deepgram error: network"); assert.equal(definitiveRefusalOf(network), undefined);
    const timeout = await withFetch(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); },
      async () => { try { await provider.transcribe(f.source, transcribeOptions); } catch (error) { return error as Error; } return undefined; });
    assert.equal(timeout?.message, "Deepgram error: timeout"); assert.equal(definitiveRefusalOf(timeout), undefined);
    // After a 2xx the work was accepted: a broken body is never a refusal, and none of it is quoted.
    const accepted = await withFetch(async () => new Response("<html>not json</html>", { status: 200 }),
      async () => { try { await provider.transcribe(f.source, transcribeOptions); } catch (error) { return error as Error; } return undefined; });
    assert.equal(accepted?.message, "Deepgram error: invalid-response (HTTP 200)"); assert.equal(definitiveRefusalOf(accepted), undefined);
    // A local cancellation and a revoked key are not provider failures.
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(provider.transcribe(f.source, { ...transcribeOptions, abortSignal: aborted.signal }), /^Error: Transcription cancelled locally$/);
    await assert.rejects(provider.transcribe(f.source, { ...transcribeOptions, beforeRequest: () => { throw new CredentialError("credential_revoked_local"); } }),
      (error: unknown) => error instanceof CredentialError && error.code === "credential_revoked_local");
  } finally { f.cleanup(); }
});

test("typed errors: OpenAI is definitive only for its documented 401, region 403 and quota 429 shapes", async () => {
  const f = fixture();
  try {
    const region = JSON.stringify({ error: { message: "Country, region, or territory not supported", type: "request_forbidden" } });
    const body = (error: Record<string, string>) => JSON.stringify({ error });
    assert.equal(classifyOpenAiRefusal(401, ""), "rejected");
    assert.equal(classifyOpenAiRefusal(403, region), "rejected");
    assert.equal(classifyOpenAiRefusal(403, ""), undefined, "any other 403 is not a documented refusal");
    assert.equal(classifyOpenAiRefusal(403, body({ message: "You do not have access to this resource" })), undefined);
    assert.equal(classifyOpenAiRefusal(402, body({ type: "insufficient_quota" })), undefined, "OpenAI documents no 402");
    assert.equal(classifyOpenAiRefusal(429, body({ type: "insufficient_quota" })), "exhausted");
    for (const code of ["credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"]) {
      assert.equal(classifyOpenAiRefusal(429, body({ type: "rate_limit_error", code })), "exhausted", code);
    }
    for (const code of ["insufficient_quota", "billing_hard_limit_reached", "rate_limit_exceeded", "slow_down"]) {
      assert.equal(classifyOpenAiRefusal(429, body({ type: "rate_limit_error", code })), undefined, `${code} is not a documented quota code`);
    }
    assert.equal(classifyOpenAiRefusal(429, "not json"), undefined);
    assert.equal(classifyOpenAiRefusal(500, body({ type: "insufficient_quota" })), undefined, "quota wording on a server error is not definitive");
    assert.equal(classifyOpenAiRefusal(503, region), undefined);

    const provider = new OpenAiWhisperProvider(K1, "whisper-1", undefined, 1000);
    const attempt = (status: number, text: string) => withFetch(async (url) => {
      assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
      return new Response(text, { status });
    }, async () => { try { await provider.transcribe(f.source, transcribeOptions); } catch (error) { return error as Error; } throw new Error("expected a failure"); });
    const exhausted = await attempt(429, body({ type: "insufficient_quota", message: "You exceeded your current quota" }));
    assert.deepEqual(definitiveRefusalOf(exhausted), { provider: "openai_whisper", kind: "exhausted", status: 429 });
    assert.equal(exhausted.message, "OpenAI Whisper error: payment-or-quota (HTTP 429) [insufficient_quota]");
    const rejected = await attempt(401, body({ message: `Incorrect API key provided: ${K1.slice(0, 8)}****${K1.slice(-4)}`, code: "invalid_api_key" }));
    assert.equal(definitiveRefusalOf(rejected)?.kind, "rejected");
    assert.equal(rejected.message, "OpenAI Whisper error: authentication (HTTP 401) [invalid_api_key]");
    assert.equal(definitiveRefusalOf(await attempt(403, region))?.kind, "rejected");
    const limited = await attempt(429, body({ type: "rate_limit_error", code: "rate_limit_exceeded" }));
    assert.equal(definitiveRefusalOf(limited), undefined);
    assert.equal(limited.message, "OpenAI Whisper error: rate-limit (HTTP 429) [rate_limit_exceeded]");
    assert.equal((await attempt(500, "server error")).message, "OpenAI Whisper error: server-error (HTTP 500)");

    // Unclassified refusals fail with fixed parts and are logged with the status code only.
    const privateDetail = "private-detail-from-provider-body";
    for (const status of [402, 403]) {
      const { result, lines } = await captureLogs(() => attempt(status, body({ message: privateDetail })));
      assert.equal(definitiveRefusalOf(result), undefined); assert.ok(result instanceof ProviderHttpError);
      assert.equal(result.message, `OpenAI Whisper error: ${status === 402 ? "payment-or-quota" : "authentication"} (HTTP ${status})`);
      const logged = lines.filter((line) => line.includes("not a documented definitive refusal"));
      assert.equal(logged.length, 1); assert.ok(logged[0]!.includes(`OpenAI answered HTTP ${status}`));
      assert.equal(lines.join("").includes(privateDetail), false, "no log line carries the provider body");
    }

    // After a 2xx the work was accepted: a broken body is never a refusal, and none of it is quoted.
    const accepted = await withFetch(async () => new Response("<html>not json</html>", { status: 200 }),
      async () => { try { await provider.transcribe(f.source, transcribeOptions); } catch (error) { return error as Error; } return undefined; });
    assert.equal(accepted?.message, "OpenAI Whisper error: invalid-response (HTTP 200)"); assert.equal(definitiveRefusalOf(accepted), undefined);
  } finally { f.cleanup(); }
});

test("typed errors: AssemblyAI is definitive only for documented shapes before the create call accepts the work", async () => {
  const balance = "Your current account balance is negative. Please top up to continue using the API.";
  const documentedBalance = () => new ProviderHttpError("AssemblyAI", 400, { category: "payment-or-quota" });
  for (const phase of ["upload", "create"] as const) {
    assert.deepEqual(classifyAssemblyAiSubmissionRefusal(new ProviderHttpError("AssemblyAI", 401), phase), { provider: "assemblyai", kind: "rejected", status: 401 });
    assert.equal(classifyAssemblyAiSubmissionRefusal(new ProviderHttpError("AssemblyAI", 400), phase), undefined, "an ordinary bad request");
    assert.equal(classifyAssemblyAiSubmissionRefusal(new ProviderHttpError("AssemblyAI", 403), phase), undefined,
      "403 is ambiguous in AssemblyAI's own documentation, so it never moves work");
    assert.equal(classifyAssemblyAiSubmissionRefusal(new ProviderHttpError("AssemblyAI", 402), phase), undefined, "402 is not documented for this API");
    assert.equal(classifyAssemblyAiSubmissionRefusal(new ProviderHttpError("AssemblyAI", 429), phase), undefined);
    assert.equal(classifyAssemblyAiSubmissionRefusal(new ProviderHttpError("AssemblyAI", 500, { category: "payment-or-quota" }), phase), undefined);
    for (const status of [400, 402, 500, undefined]) {
      assert.equal(classifyAssemblyAiSubmissionRefusal(new InsufficientCreditsError("AssemblyAI", status), phase), undefined,
        "the adapter's older credit wordings are not documented shapes");
    }
    assert.equal(classifyAssemblyAiSubmissionRefusal(new ProviderError({ provider: "AssemblyAI", category: "timeout" }), phase), undefined);
    assert.equal(classifyAssemblyAiSubmissionRefusal(new Error("AssemblyAI request timed out"), phase), undefined);
  }
  assert.deepEqual(classifyAssemblyAiSubmissionRefusal(documentedBalance(), "create"), { provider: "assemblyai", kind: "exhausted", status: 400 });
  assert.equal(classifyAssemblyAiSubmissionRefusal(documentedBalance(), "upload"), undefined,
    "the negative-balance refusal is documented for the create call only");

  const outcome = async (stub: (client: AssemblyAiClient) => void) => {
    const client = new AssemblyAiClient("test-assemblyai-key", 1000, 0);
    client.uploadAudio = async () => "https://upload.test/audio";
    client.createTranscript = async () => ({ id: "job-1", status: "queued" });
    client.getTranscript = async () => ({ id: "job-1", status: "completed", text: "done" });
    stub(client);
    try { await client.transcribe("audio.mp3", transcribeOptions); } catch (error) { return error as Error; }
    return undefined;
  };
  // Before acceptance.
  const uploadRejected = await outcome((client) => { client.uploadAudio = async () => { throw new ProviderHttpError("AssemblyAI upload", 401); }; });
  assert.deepEqual(definitiveRefusalOf(uploadRejected), { provider: "assemblyai", kind: "rejected", status: 401 });
  assert.equal(uploadRejected?.message, "AssemblyAI upload error: authentication (HTTP 401)");
  const createExhausted = await outcome((client) => { client.createTranscript = async () => { throw documentedBalance(); }; });
  assert.deepEqual(definitiveRefusalOf(createExhausted), { provider: "assemblyai", kind: "exhausted", status: 400 });
  assert.equal(createExhausted?.message, "AssemblyAI error: payment-or-quota (HTTP 400)");

  // Undocumented shapes fail as before and are logged with the status code only.
  const credits = await captureLogs(() => outcome((client) => { client.createTranscript = async () => { throw new InsufficientCreditsError("AssemblyAI", 402); }; }));
  assert.ok(credits.result instanceof InsufficientCreditsError, "the existing stop-the-run class is preserved");
  assert.equal(definitiveRefusalOf(credits.result), undefined);
  const forbidden = await captureLogs(() => outcome((client) => { client.uploadAudio = async () => { throw new ProviderHttpError("AssemblyAI upload", 403); }; }));
  assert.ok(forbidden.result instanceof ProviderHttpError); assert.equal(definitiveRefusalOf(forbidden.result), undefined);
  for (const [status, lines] of [[402, credits.lines], [403, forbidden.lines]] as const) {
    const logged = lines.filter((line) => line.includes("not a documented definitive refusal"));
    assert.equal(logged.length, 1); assert.ok(logged[0]!.includes(`AssemblyAI answered HTTP ${status}`));
  }
  const ordinary = await captureLogs(() => outcome((client) => { client.createTranscript = async () => { throw new ProviderHttpError("AssemblyAI", 400); }; }));
  assert.equal(ordinary.lines.some((line) => line.includes("not a documented definitive refusal")), false, "an ordinary bad request is not refusal-like");

  // After the upload, an unanswered or failed create call may still have created billable work.
  for (const error of [new ProviderError({ provider: "AssemblyAI", category: "timeout" }), new ProviderError({ provider: "AssemblyAI", category: "network" }),
    new ProviderHttpError("AssemblyAI", 503)]) {
    assert.equal(definitiveRefusalOf(await outcome((client) => { client.createTranscript = async () => { throw error; }; })), undefined);
  }
  // After acceptance nothing is definitive, whatever the provider says.
  for (const error of [new ProviderHttpError("AssemblyAI", 401), documentedBalance(), new InsufficientCreditsError("AssemblyAI", 402)]) {
    assert.equal(definitiveRefusalOf(await outcome((client) => { client.getTranscript = async () => { throw error; }; })), undefined);
  }
  // A job that ends in error after acceptance: neither the provider's explanation nor its job identifier is quoted.
  const jobError = await outcome((client) => { client.getTranscript = async () => ({ id: "job-1", status: "error", error: balance }); });
  assert.equal(jobError?.message, "AssemblyAI error: transcription-failed; the accepted job ended in error at the provider");
  assert.equal(definitiveRefusalOf(jobError), undefined);

  // Through the real HTTP layer.
  const f = fixture();
  try {
    const drive = async (handler: (url: string, init?: RequestInit) => Response | Promise<Response>, options = transcribeOptions) => {
      const seen: string[] = [];
      const error = await withFetch(async (url, init) => { seen.push(`${init?.method} ${url.replace("https://api.assemblyai.com/v2", "")}`); return handler(url, init); },
        async () => { try { await new AssemblyAiClient(K1, 1000, 0).transcribe(f.source, options); } catch (caught) { return caught as Error; } return undefined; });
      return { seen, error };
    };
    const uploaded = () => Response.json({ upload_url: "https://cdn.assemblyai.test/upload/1" });
    // The documented 400 at POST /v2/transcript.
    const refused = await drive((url) => url.endsWith("/upload") ? uploaded() : new Response(JSON.stringify({ error: balance }), { status: 400 }));
    assert.deepEqual(refused.seen, ["POST /upload", "POST /transcript"]);
    assert.deepEqual(definitiveRefusalOf(refused.error), { provider: "assemblyai", kind: "exhausted", status: 400 });
    assert.equal(refused.error?.message, "AssemblyAI error: payment-or-quota (HTTP 400)");
    // The same wording at upload, where it is not documented, never moves work.
    const atUpload = await drive(() => new Response(JSON.stringify({ error: balance }), { status: 400 }));
    assert.deepEqual(atUpload.seen, ["POST /upload"]); assert.equal(definitiveRefusalOf(atUpload.error), undefined);
    // After the upload, a create call with no answer.
    const unanswered = await drive((url) => { if (url.endsWith("/upload")) return uploaded(); throw new TypeError("fetch failed"); });
    assert.deepEqual(unanswered.seen, ["POST /upload", "POST /transcript"]);
    assert.equal(unanswered.error?.message, "AssemblyAI error: network"); assert.equal(definitiveRefusalOf(unanswered.error), undefined);
    // After a 2xx create, the same documented answers while polling are post-acceptance.
    for (const [poll, text] of [[new Response(JSON.stringify({ error: balance }), { status: 400 }), "AssemblyAI error: payment-or-quota (HTTP 400)"],
      [new Response("Authentication error, API token missing/invalid", { status: 401 }), "AssemblyAI error: authentication (HTTP 401)"]] as const) {
      const polled = await drive((url, init) => url.endsWith("/upload") ? uploaded()
        : init?.method === "POST" ? Response.json({ id: "job-9", status: "queued" }) : poll.clone());
      assert.deepEqual(polled.seen, ["POST /upload", "POST /transcript", "GET /transcript/job-9"]);
      assert.ok(polled.error instanceof ProviderHttpError); assert.equal(definitiveRefusalOf(polled.error), undefined);
      assert.equal(polled.error.message, text);
    }
    // Polling that gives up says so with fixed text; the job identifier stays inside the adapter.
    const gaveUp = await drive((url, init) => url.endsWith("/upload") ? uploaded()
      : init?.method === "POST" ? Response.json({ id: "job-7", status: "queued" }) : Response.json({ id: "job-7", status: "processing" }),
      { ...transcribeOptions, maxPollMinutes: 0 });
    assert.equal(gaveUp.error?.message, "AssemblyAI error: timeout; polling gave up after 0 minutes; the upstream job was not recreated");
  } finally { f.cleanup(); }
});

test("legacy key pool never logs key characters when it cools a key down", async () => {
  const { lines } = await captureLogs(async () => {
    const pool = new MultiKeyProvider("deepgram", "Deepgram", [K1, K2], () => ({ name: "deepgram",
      getCapabilities: () => ({ supportsDiarization: true }), transcribe: async () => { throw new Error("boom"); } }),
      { supportsDiarization: true }, { failureThreshold: 1, cooldownMs: 60_000 });
    await assert.rejects(pool.transcribe("a.mp3", transcribeOptions), /boom/);
  });
  const cooldown = lines.filter((line) => line.includes("disabled for"));
  assert.equal(cooldown.length, 2);
  assert.ok(cooldown.some((line) => line.includes("Deepgram key #1 of 2")));
  for (const line of lines) for (const key of [K1, K2]) assert.equal(line.includes(key.slice(0, 4)), false, "no key prefix in logs");
});

test("web proxy: the banner's read needs the operator session and the exact query, and passes on only a rebuilt notices view (an older API's account listing is refused)", async () => {
  const previous = { ...process.env }; const fetchBefore = globalThis.fetch;
  Object.assign(process.env, { Y2T_WEB_AUTH_SECRET: "web-auth-secret-for-synthetic-tests-32", Y2T_WEB_AUTH_PASSPHRASE: "synthetic-passphrase",
    Y2T_API_KEY: "operator-key-synthetic-32-characters", Y2T_API_BASE_URL: "http://api.example.test" });
  const forwarded: Array<{ url: string; method: string; key: string | null }> = [];
  const accountA = "5b0f2f6e-3c1d-4e7a-9b2c-0d1e2f3a4b5c"; const accountB = "6c1a3b7f-4d2e-4f8b-8c3d-1e2f3a4b5c6d";
  const notice = { id: "7d2b4c80-5e3f-4a9c-9d4e-2f3a4b5c6d7e", kind: "moved", reason: "exhausted", status: 402,
    from: { accountId: accountA, label: "Cuenta personal", provider: "deepgram", keyHint: `••••${K1.slice(-4)}` },
    to: { accountId: accountB, label: "Cuenta de respaldo", provider: "assemblyai", keyHint: `••••${K3.slice(-4)}` },
    serviceChanged: true, count: 2, firstAt: "2026-11-12T10:00:00.000Z", lastAt: "2026-11-12T10:05:00.000Z" };
  const routing = { enabled: true, state: "account", reason: null, provider: "assemblyai", accountLabel: "Cuenta de respaldo" };
  const noticesView = { view: "notices", notices: [notice], total: 1, routing };
  // What an API older than 0.43.0 answers to the very same request: it ignores the query and lists the accounts.
  const olderApi = { configured: true, activeProvider: "deepgram", selectedAccountId: accountA, selectionReady: true,
    accounts: [{ id: accountA, provider: "deepgram", label: "Cuenta personal", enabled: true, selected: true, currentCredentialId: notice.id,
      keys: [{ id: notice.id, hint: `••••${K1.slice(-4)}`, revoked: false, createdAt: "2026-10-24T09:00:00.000Z", check: null }] }],
    legacy: [{ provider: "deepgram", keys: [`••••${LEGACY_KEY.slice(-4)}`], selected: false }] };
  let upstream: () => Response = () => Response.json(noticesView);
  try {
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      forwarded.push({ url: String(url), method: init?.method ?? "GET", key: new Headers(init?.headers).get("x-api-key") });
      return upstream();
    }) as typeof fetch;
    const session = await issueWebSessionToken();
    const request = (query: string, init: RequestInit = {}, cookie = `${WEB_SESSION_COOKIE}=${session}`) =>
      proxyCredentials(new Request(`https://console.test/api/provider-accounts${query}`, { ...init, headers: { cookie, ...(init.headers ?? {}) } }));

    assert.equal((await request("?view=notices", {}, "")).status, 401, "no session, no notices");
    assert.equal((await request("?view=notices", {}, `${WEB_SESSION_COOKIE}=forged`)).status, 401);
    assert.deepEqual(forwarded, []);

    const ok = await request("?view=notices");
    assert.equal(ok.status, 200); assert.equal(ok.headers.get("cache-control"), "no-store");
    assert.deepEqual(await ok.json(), noticesView);
    assert.deepEqual(forwarded, [{ url: "http://api.example.test/provider-accounts?view=notices", method: "GET", key: "operator-key-synthetic-32-characters" }]);

    // Any other query on this route is refused: never forwarded, never answered with the account snapshot.
    for (const query of ["?view=notices&debug=1", "?view=everything", "?view=notices&view=notices", "?debug=1", "?view="]) {
      const refused = await request(query);
      assert.equal(refused.status, 400, query); assert.deepEqual(await refused.json(), { error: "invalid_request" });
    }
    assert.equal((await request("?view=notices", { method: "POST", body: "{}", headers: { origin: "https://console.test" } })).status, 400);
    assert.equal(forwarded.length, 1);

    // Nothing the API sends is passed on as it came. The answer is read as the notices view and built again
    // from the allowed fields; a field this code does not know is left behind.
    upstream = () => Response.json({ ...noticesView, routing: { ...routing, debug: K2 },
      notices: [{ ...notice, internalNote: K2, from: { ...notice.from, token: K1 } }] });
    const rebuilt = await request("?view=notices");
    assert.equal(rebuilt.status, 200); assert.deepEqual(await rebuilt.json(), noticesView);

    // Mixed rollout, and every other answer that is not the notices view: refused with a fixed error, nothing passed on.
    const notTheView: Array<[string, () => Response, string]> = [
      ["the account listing of an older API", () => Response.json(olderApi), "api_answer_not_notices_view"],
      ["that listing carrying the mark", () => Response.json({ ...olderApi, view: "notices", notices: [], routing }), "api_answer_not_notices_view"],
      ["the view with an account listing beside it", () => Response.json({ ...noticesView, accounts: olderApi.accounts }), "api_answer_not_notices_view"],
      ["the view without its mark", () => Response.json({ notices: [notice], routing }), "api_answer_not_notices_view"],
      ["a notice whose hint is a whole key", () => Response.json({ ...noticesView, notices: [{ ...notice, from: { ...notice.from, keyHint: K1 } }] }),
        "api_answer_not_notices_view"],
      ["a notice with a field missing", () => Response.json({ ...noticesView, notices: [{ ...notice, to: undefined }] }), "api_answer_not_notices_view"],
      ["routing in an unknown state", () => Response.json({ ...noticesView, routing: { ...routing, state: "everything" } }), "api_answer_not_notices_view"],
      ["an answer that is not JSON", () => new Response(`<html>${K1} Cuenta personal</html>`, { status: 200 }), "api_answer_not_notices_view"],
      ["an API failure", () => Response.json({ error: "internal", detail: `key ${K1}`, accounts: olderApi.accounts }, { status: 500 }), "api_refused_notices"],
      ["an API refusal", () => Response.json({ ...olderApi, error: "unauthorized" }, { status: 401 }), "api_refused_notices"],
    ];
    for (const [label, answer, error] of notTheView) {
      upstream = answer;
      const refused = await request("?view=notices");
      const text = await refused.text();
      assert.equal(refused.status, 502, label); assert.deepEqual(JSON.parse(text), { error }, label);
      for (const privateText of [K1, K1.slice(-4), LEGACY_KEY.slice(-4), "••••", "Cuenta personal", accountA]) {
        assert.equal(text.includes(privateText), false, `${label}: nothing from the API reaches the banner`);
      }
    }
    const read = readNoticesView(noticesView);
    assert.deepEqual(read, noticesView); assert.notEqual(read, noticesView, "a new object, never the API's own");
    for (const other of [null, [], "notices", olderApi, { view: "notices" }, { view: "notices", notices: [], routing: null }]) {
      assert.equal(readNoticesView(other), undefined);
    }

    // The view carries its newest notices and the total of pending ones, which may be larger. An API from
    // 0.43.0 to 0.43.5 sends every notice and no total: its view is still read, and the list is its own total.
    const beforeTotal = { view: "notices", notices: [notice], routing };
    assert.deepEqual(readNoticesView(beforeTotal), noticesView);
    assert.deepEqual(readNoticesView({ ...noticesView, total: 620 }), { ...noticesView, total: 620 });
    assert.deepEqual(readNoticesView({ ...noticesView, total: Number.MAX_SAFE_INTEGER }), { ...noticesView, total: Number.MAX_SAFE_INTEGER },
      "the count of pending notices is never a reason to refuse the view");
    for (const total of [0, -1, 1.5, "1", null, 2 ** 53]) {
      assert.equal(readNoticesView({ ...noticesView, total }), undefined, `total ${String(total)} is not a count of at least the notices carried`);
    }
    assert.equal(readNoticesView({ ...noticesView, total: 620, accounts: olderApi.accounts }), undefined);
    upstream = () => Response.json(beforeTotal);
    assert.deepEqual(await (await request("?view=notices")).json(), noticesView, "the view of an older API gets its total from its list");
    upstream = () => Response.json({ ...noticesView, total: 620 });
    assert.deepEqual(await (await request("?view=notices")).json(), { ...noticesView, total: 620 });

    // Without a query the same path is the accounts screen's own read.
    upstream = () => Response.json(olderApi);
    assert.equal((await request("")).status, 200);
    assert.equal(forwarded.at(-1)!.url, "http://api.example.test/provider-accounts");

    assert.equal(isExactNoticesQuery(new URLSearchParams("view=notices")), true);
    for (const query of ["", "view=Notices", "view=notices&x=1", "x=1&view=notices", "view=notices&view=notices"]) {
      assert.equal(isExactNoticesQuery(new URLSearchParams(query)), false, query);
    }
  } finally {
    globalThis.fetch = fetchBefore;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("notices view: the 50 newest and the true total whatever is pending, every notice still on the accounts screen, and a read that keeps failing is said", () => {
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Personal", [K1]); const b = f.store.create("assemblyai", "Respaldo", [K3]);
    f.store.select(a);
    assert.deepEqual([f.store.noticesView("deepgram").total, f.store.noticesView("deepgram").notices.length], [0, 0]);

    // Far more pending notices than the web proxy accepts in one answer (500, or 262,144 characters).
    const pending = 620;
    const id = (n: number) => `notice-${String(n).padStart(4, "0")}`;
    const db = new DatabaseSync(join(f.dir, "credentials.sqlite"));
    try {
      const insert = db.prepare("INSERT INTO failover_notices VALUES(?,?,?,?,?,?,?,?,?,1,?,?,NULL)");
      for (let n = 0; n < pending; n++) {
        const at = new Date(Date.UTC(2026, 10, 12, 10, 0, n)).toISOString();
        insert.run(id(n), "moved", "exhausted", 402, a, f.keyId(a, K1), b, f.keyId(b, K3), 1, at, at);
      }
    } finally { db.close(); }

    const view = f.store.noticesView("deepgram");
    assert.equal(NOTICES_VIEW_LIMIT, 50);
    assert.deepEqual([view.total, view.notices.length, view.notices[0]!.id, view.notices.at(-1)!.id], [pending, 50, id(619), id(570)]);
    // The answer the banner reads stays small and is the view the web proxy accepts, total included.
    const wire = JSON.stringify(view);
    assert.ok(wire.length < 262_144 / 8, `the bounded view is ${wire.length} characters`);
    assert.deepEqual(readNoticesView(JSON.parse(wire)), JSON.parse(wire));
    // The unbounded list of the same notices is what crossed the proxy's limits before: it is refused.
    const unbounded = { view: "notices", notices: f.store.notices(), routing: view.routing };
    assert.equal(unbounded.notices.length, pending); assert.equal(readNoticesView(unbounded), undefined);
    // Every pending notice is still listed for the accounts screen, where each can be dismissed.
    assert.equal(f.store.failoverState("deepgram").notices.length, pending);
    assert.equal(f.store.pendingNoticeCount(), pending);

    // Dismissing the newest brings the next one into the view; the total follows.
    f.store.dismissNotice(id(619));
    const next = f.store.noticesView("deepgram");
    assert.deepEqual([next.total, next.notices.length, next.notices[0]!.id, next.notices.at(-1)!.id], [619, 50, id(618), id(569)]);
    for (let n = 618; n >= 40; n--) f.store.dismissNotice(id(n));
    const few = f.store.noticesView("deepgram");
    assert.deepEqual([few.total, few.notices.length, few.notices[0]!.id, few.notices.at(-1)!.id], [40, 40, id(39), id(0)]);

    // The longest answer this API can give: 50 notices with every field at its longest. A label of 80
    // control characters is the longest on the wire, because JSON writes each of them with six.
    const wide = "\u0001".repeat(80);
    assert.equal(JSON.stringify(wide).length, 482);
    const party = (provider: string) => ({ accountId: "f".repeat(64), label: wide, provider, keyHint: "••••wxyz" });
    const longest = { view: "notices", total: Number.MAX_SAFE_INTEGER, routing: { enabled: true, state: "unavailable", reason: "provider_mismatch", provider: "openai_whisper", accountLabel: wide },
      notices: Array.from({ length: NOTICES_VIEW_LIMIT }, (_, n) => ({ id: `${"e".repeat(60)}${String(n).padStart(4, "0")}`, kind: "blocked", reason: "exhausted", status: 599,
        from: party("openai_whisper"), to: party("openai_whisper"), serviceChanged: false, count: Number.MAX_SAFE_INTEGER,
        firstAt: "2026-11-12T10:00:00.000+00:00", lastAt: "2026-11-12T10:00:00.000+00:00" })) };
    assert.ok(JSON.stringify(longest).length < 262_144 / 2, `the longest bounded view is ${JSON.stringify(longest).length} characters`);
    assert.deepEqual(readNoticesView(longest), longest);

    // "There are N more": the total when the API sends one, the list itself for an API that does not.
    assert.deepEqual([moreNoticesCount(620, 50), moreNoticesCount(undefined, 3), moreNoticesCount(1, 1), moreNoticesCount(0, 0), moreNoticesCount(2, 50), moreNoticesCount(1.5, 2)],
      [619, 2, 0, 0, 49, 1]);

    // One failed read is not said; two in a row are; a success clears it; a late older result changes nothing.
    const reads = createNoticeReadTracker();
    const [r1, r2, r3, r4, r5, r6] = [reads.begin(), reads.begin(), reads.begin(), reads.begin(), reads.begin(), reads.begin()];
    assert.equal(reads.failed(r1), false);
    assert.equal(reads.failed(r2), true, "the second failure in a row is said on the banner");
    assert.equal(reads.succeeded(r3), false, "a success clears the warning");
    assert.equal(reads.failed(r5), false);
    assert.equal(reads.succeeded(r4), false, "a success older than a counted failure does not clear it");
    assert.equal(reads.failed(r4), false, "nor is an older failure counted twice");
    assert.equal(reads.failed(r6), true);

    // The two rules together, as the console uses them. An answer that the snapshot gate drops did not
    // refresh the banner, so it must not clear the warning or restart the count of failures.
    const gate = createSnapshotGate(); const reader = createNoticeReader(gate);
    assert.deepEqual(reader.settle(reader.begin(), false), { apply: false, warn: false });
    assert.deepEqual(reader.settle(reader.begin(), false), { apply: false, warn: true }, "two failed reads: the banner warns");
    const overtaken = reader.begin();
    gate.changed(); gate.changed();   // the operator changes something on the accounts screen while that read is in flight
    assert.deepEqual(reader.settle(overtaken, true), { apply: false, warn: true }, "a dropped answer leaves the warning up");
    assert.deepEqual(reader.settle(reader.begin(), false), { apply: false, warn: true }, "and the next failure still warns");
    assert.deepEqual(reader.settle(reader.begin(), true), { apply: true, warn: false }, "an applied answer clears it");
    // Without a warning up, a dropped answer does not hide the failures counted before it either.
    assert.deepEqual(reader.settle(reader.begin(), false), { apply: false, warn: false });
    const dropped = reader.begin(); gate.changed(); gate.changed();
    assert.deepEqual(reader.settle(dropped, true), { apply: false, warn: false });
    assert.deepEqual(reader.settle(reader.begin(), false), { apply: false, warn: true }, "the failure before the dropped answer still counts");
    // An older answer arriving after a newer one was applied is dropped by the gate and changes nothing.
    const older = reader.begin(); const newer = reader.begin();
    assert.deepEqual(reader.settle(newer, true), { apply: true, warn: false });
    assert.deepEqual(reader.settle(older, true), { apply: false, warn: false });
    const es = failoverReadFailureText((spanish) => spanish); const en = failoverReadFailureText((_, english) => english);
    assert.match(es, /No se ha podido comprobar/); assert.match(es, /puede estar desactualizado/); assert.match(en, /may be out of date/);
  } finally { f.cleanup(); }
});

test("account API and public status: order, switch, notice, dismissal, unavailable selection and the fixed default status shape", async () => {
  const f = fixture(); const previous = { ...process.env };
  const proofSecret = "ef".repeat(32);
  Object.assign(process.env, { Y2T_API_KEY: "synthetic-operator-key-0000000000000000",
    Y2T_CREDENTIALS_DIR: f.dir, Y2T_CREDENTIAL_MASTER_KEY: master,
    Y2T_CREDENTIAL_ADMIN_PROOF_SECRET: proofSecret, Y2T_INTAKE_WORKER_ENABLED: "false" });
  let server: Awaited<ReturnType<typeof startApiServer>>["server"] | undefined;
  type Snapshot = { accountId?: string; failover: ReturnType<CredentialStore["failoverState"]>; accounts: ReturnType<CredentialStore["list"]> };
  type Status = { condition: string; severity: string; summary: string; checks: Array<Record<string, unknown>> } & Record<string, unknown>;
  try {
    ({ server } = await startApiServer(f.config, { host: "127.0.0.1", port: 0, persistRuns: false, maxBufferedEventsPerRun: 10 }));
    if (!server.listening) await new Promise<void>((resolve) => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const headers = { "x-api-key": process.env.Y2T_API_KEY!, "content-type": "application/json" };
    const mutate = async (action: object) => {
      const body = JSON.stringify(action);
      const response = await fetch(`${base}/provider-accounts`, { method: "POST", body, headers: { ...headers, "x-m2t-admin-proof": signAdminProof(body, proofSecret) } });
      return { status: response.status, body: await response.json() as Snapshot & { error?: string } };
    };
    const status = async (query = "") => (await (await fetch(`${base}/status/media-pipeline${query}`)).json()) as Status;
    // The deployed house monitor pins this exact default shape; it must not change.
    const assertFixedShape = (value: Status) => {
      assert.deepEqual(Object.keys(value).sort(), ["checks", "condition", "observed_at", "severity", "summary"]);
      assert.ok(["ok", "degraded"].includes(value.condition)); assert.ok(["none", "warning"].includes(value.severity));
      assert.ok(value.summary.length <= 180);
      assert.deepEqual(value.checks.map((check) => check.name), ["media_intake", "transcript_delivery", "source_status_delivery"]);
      for (const check of value.checks) {
        assert.deepEqual(Object.keys(check).sort(), ["condition", "label", "name", "severity", "summary"]);
        assert.ok(["none", "warning"].includes(String(check.severity))); assert.ok(String(check.summary).length <= 180);
      }
    };

    const initial = await status(); assertFixedShape(initial); assert.equal(initial.condition, "ok");
    const off = (await status("?include=stt_account_failover")).checks[3]!;
    assert.deepEqual({ name: off.name, condition: off.condition, severity: off.severity, pending: off.pending_notices, changed: off.service_changed, blocked: off.blocked },
      { name: "stt_account_failover", condition: "ok", severity: "none", pending: 0, changed: false, blocked: false });
    assert.equal(off.summary, "Automatic account change is off.");

    const a = (await mutate({ action: "create", provider: "deepgram", label: "Cuenta personal", token: K1 })).body.accountId!;
    const b = (await mutate({ action: "create", provider: "assemblyai", label: "Cuenta de respaldo", token: K3 })).body.accountId!;
    assert.equal((await mutate({ action: "add_key", accountId: a, token: K2 })).status, 200);
    assert.equal((await mutate({ action: "select", accountId: a })).status, 200);

    // The selected account is disabled: admission refuses new work, also with the switch off and no notice pending.
    // The public status says so with one fixed sentence: no alias, no reason, no identifier.
    const refusal = "The selected transcription account cannot take work; new work is refused until the operator acts.";
    assert.equal((await mutate({ action: "enable", accountId: a, enabled: false })).status, 200);
    assert.throws(() => f.store.pinForNewWork("deepgram"), /selected_account_unavailable/);
    const refusing = await status(); assertFixedShape(refusing);
    assert.deepEqual([refusing.condition, refusing.severity, refusing.summary], ["degraded", "warning", refusal]);
    const refusingDetail = await status("?include=stt_account_failover");
    assert.deepEqual(refusingDetail.checks[3], { name: "stt_account_failover", label: "Transcription account failover", condition: "degraded",
      severity: "warning", summary: refusal, pending_notices: 0, service_changed: false, blocked: false, selection_unavailable: true });
    for (const text of [JSON.stringify(refusing), JSON.stringify(refusingDetail)]) {
      for (const privateText of ["Cuenta personal", ...HINTS, "••••", a, "account_disabled"]) assert.equal(text.includes(privateText), false);
    }
    assert.equal((await mutate({ action: "enable", accountId: a, enabled: true })).status, 200);
    assert.equal((await status()).condition, "ok");

    const unsigned = await fetch(`${base}/provider-accounts`, { method: "POST", headers, body: JSON.stringify({ action: "set_failover", enabled: true }) });
    assert.equal(unsigned.status, 403, "the switch needs the same recent-authentication proof as any key change");
    assert.equal((await mutate({ action: "set_failover_order", accountIds: [b] })).status, 200);
    assert.equal((await mutate({ action: "set_failover_order", accountIds: [b, b] })).status, 409);
    assert.equal((await mutate({ action: "set_failover", enabled: "yes" })).status, 400);
    const enabled = await mutate({ action: "set_failover", enabled: true });
    assert.equal(enabled.status, 200); assert.equal(enabled.body.failover.enabled, true); assert.deepEqual(enabled.body.failover.order, [b]);
    const account = enabled.body.accounts.find((item) => item.id === a)!;
    const [current, older] = account.keyOrder;
    assert.equal(enabled.body.failover.effective?.credentialId, current);
    assert.equal((await mutate({ action: "set_key_order", accountId: a, credentialIds: [current, older] })).status, 200);

    // A definitive refusal recorded by a running job (second connection to the same private database).
    f.store.recordRefusal({ pin: { provider: "deepgram", accountId: a, credentialId: current! }, kind: "exhausted", status: 402, workIds: [] });
    f.store.recordRefusal({ pin: { provider: "deepgram", accountId: a, credentialId: older! }, kind: "exhausted", status: 402, workIds: [] });
    const read = await (await fetch(`${base}/provider-accounts`, { headers })).json() as Snapshot;
    assert.equal(read.failover.notices.length, 2);
    const cross = read.failover.notices.find((notice) => notice.serviceChanged)!;
    assert.equal(cross.from.label, "Cuenta personal"); assert.equal(cross.to?.label, "Cuenta de respaldo");
    assert.equal(cross.to?.provider, "assemblyai"); assert.equal(cross.from.keyHint, `••••${K1.slice(-4)}`);
    assert.equal(read.failover.effective?.accountId, b);
    assert.equal(read.accounts.find((item) => item.id === a)!.keys.every((key) => key.health.exhausted?.since && key.health.rejected === null), true);
    assertNoSecret("account snapshot", read);

    const degraded = await status(); assertFixedShape(degraded);
    assert.equal(degraded.condition, "degraded"); assert.equal(degraded.severity, "warning");
    assert.equal(degraded.summary, "An automatic transcription account change needs operator review.");
    const detailed = await status("?include=stt_account_failover");
    assert.equal(detailed.checks.length, 4);
    assert.deepEqual(detailed.checks[3], { name: "stt_account_failover", label: "Transcription account failover", condition: "degraded",
      severity: "warning", summary: "2 automatic account change notice(s) await operator review; the transcription service changed.",
      pending_notices: 2, service_changed: true, blocked: false, selection_unavailable: false });
    for (const text of [JSON.stringify(degraded), JSON.stringify(detailed)]) {
      assertNoSecret("public status", text);
      for (const privateText of ["Cuenta personal", "Cuenta de respaldo", ...HINTS, "••••", a, b]) {
        assert.equal(text.includes(privateText), false, "the public status exposes no alias, key hint or identifier");
      }
    }

    // The banner shown on every screen reads notices and current routing only.
    const view = await (await fetch(`${base}/provider-accounts?view=notices`, { headers })).json() as
      { view: string; notices: FailoverNotice[]; total: number; routing: Record<string, unknown> };
    assert.deepEqual(Object.keys(view).sort(), ["notices", "routing", "total", "view"], "no account listing and no legacy keys");
    assert.equal(view.total, 2, "the total counts every pending notice");
    assert.equal(view.view, "notices", "the answer is marked, so the web can tell it from an older API's account listing");
    assert.deepEqual(readNoticesView(view), view, "the web's reader accepts exactly what this API answers");
    assert.equal(readNoticesView(read), undefined, "and never the account listing");
    assert.equal(view.notices.length, 2);
    assert.deepEqual(view.routing, { enabled: true, state: "account", reason: null, provider: "assemblyai", accountLabel: "Cuenta de respaldo" });
    for (const query of ["?view=other", "?view=notices&debug=1", "?view=notices&view=notices", "?debug=1"]) {
      const refusedQuery = await fetch(`${base}/provider-accounts${query}`, { headers });
      assert.equal(refusedQuery.status, 400, `${query} must be refused, not answered with the account snapshot`);
      assert.deepEqual(await refusedQuery.json(), { error: "invalid_request" });
    }
    assert.equal(JSON.stringify(view.routing).includes("••••"), false, "current routing carries no key hint");
    assert.equal(JSON.stringify(view).includes(LEGACY_KEY.slice(-4)), false, "no suffix of the existing configuration leaves the accounts screen");
    assert.ok(JSON.stringify(read).includes(LEGACY_KEY.slice(-4)), "only the authenticated accounts screen lists the existing keys");
    assertNoSecret("notices view", view);
    assert.equal((await fetch(`${base}/provider-accounts?view=notices`)).status, 401);
    assertFixedShape(await status("?include=everything"));

    // The web origin forwards only the exact opt-in.
    const forwarded: string[] = [];
    const originalFetch = globalThis.fetch; const apiBase = process.env.Y2T_API_BASE_URL;
    process.env.Y2T_API_BASE_URL = "http://api.test";
    globalThis.fetch = (async (input: unknown) => { forwarded.push(String(input)); return Response.json({ condition: "ok" }); }) as typeof fetch;
    try {
      await proxyPublicMediaStatus(new Request("https://console.test/api/status/media-pipeline?include=stt_account_failover&x=1"));
      await proxyPublicMediaStatus(new Request("https://console.test/api/status/media-pipeline?include=other&debug=1"));
      await proxyPublicMediaStatus();
    } finally {
      globalThis.fetch = originalFetch;
      if (apiBase === undefined) delete process.env.Y2T_API_BASE_URL; else process.env.Y2T_API_BASE_URL = apiBase;
    }
    assert.deepEqual(forwarded, ["http://api.test/status/media-pipeline?include=stt_account_failover",
      "http://api.test/status/media-pipeline", "http://api.test/status/media-pipeline"]);

    // Dismissing tells the monitor the operator has seen it; health stays until he acts.
    for (const notice of read.failover.notices) assert.equal((await mutate({ action: "dismiss_notice", noticeId: notice.id })).status, 200);
    assert.equal((await mutate({ action: "dismiss_notice", noticeId: read.failover.notices[0]!.id })).status, 409);
    const acknowledged = await status("?include=stt_account_failover");
    assert.equal(acknowledged.condition, "ok");
    assert.equal(acknowledged.checks[3]!.summary, "Automatic account change is on; 2 key(s) stay marked rejected or exhausted.");
    const reset = await mutate({ action: "reset_key_health", accountId: a, credentialId: current });
    assert.equal(reset.status, 200); assert.equal(reset.body.failover.effective?.credentialId, current);
    assert.equal((await mutate({ action: "reset_key_health", accountId: b, credentialId: current })).status, 409);

    // Nothing left: the aggregate degrades and the named check says blocked.
    f.store.recordRefusal({ pin: { provider: "deepgram", accountId: a, credentialId: current! }, kind: "exhausted", status: 402, workIds: [] });
    f.store.recordRefusal({ pin: { provider: "assemblyai", accountId: b, credentialId: read.accounts.find((item) => item.id === b)!.currentCredentialId },
      kind: "rejected", status: 401, workIds: [] });
    const blocked = await status("?include=stt_account_failover");
    assert.equal(blocked.condition, "degraded"); assert.equal(blocked.checks[3]!.blocked, true);
    const blockedDefault = await status(); assertFixedShape(blockedDefault);
    assert.equal(blockedDefault.summary, "No healthy transcription key or account is left; new work fails until the operator acts.");
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous); f.cleanup();
  }
});

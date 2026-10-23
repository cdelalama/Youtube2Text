import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, copyFileSync, chmodSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { CredentialStore, applyCredential } from "../src/credentials/store.js";
import { configSchema } from "../src/config/schema.js";
import { signAdminProof, verifyAdminProof } from "../src/credentials/adminProof.js";
import { probeCredential } from "../src/credentials/probe.js";
import { RunManager } from "../src/api/runManager.js";
import { MediaJobStore } from "../src/jobs/store.js";
import { issueWebSessionToken, WEB_SESSION_COOKIE } from "../web/lib/webAuth.js";
import { proxyCredentials } from "../web/lib/credentialProxy.js";
import { startApiServer } from "../src/api/server.js";
import { credentialRoutes } from "../src/credentials/routes.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { IntakeWorker } from "../src/jobs/intakeWorker.js";
import { checkAssemblyAiCredits } from "../src/pipeline/run.js";
import { execCommand } from "../src/utils/exec.js";

const master = "ab".repeat(32);
const secret1 = "synthetic-provider-key-1111";
const secret2 = "synthetic-provider-key-2222";
const secret3 = "synthetic-provider-key-3333";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "m2t-accounts-"));
  const config = configSchema.parse({ outputDir: join(root, "output"), audioDir: join(root, "audio"),
    sttProvider: "deepgram", deepgramApiKey: "legacy-synthetic-key", deepgramApiKeys: ["legacy-pool-key"] });
  const dir = join(root, "private");
  const store = new CredentialStore(dir, master, [config.outputDir, config.audioDir]);
  return { root, dir, config, store, cleanup: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("accounts encrypt keys, survive restart and restore, and never expose key values", () => {
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Personal", [secret1]);
    f.store.create("deepgram", "Work", [secret2]);
    f.store.create("openai_whisper", "OpenAI", [secret3]);
    assert.equal(f.store.pin("deepgram"), undefined, "saving must not select");
    f.store.select(a);
    const pin = f.store.pin("deepgram")!;
    assert.equal(applyCredential(f.config, pin, f.store).deepgramApiKey, secret1);
    assert.equal(applyCredential(f.config, pin, f.store).deepgramApiKeys, undefined, "no cross-key failover");
    assert.throws(() => f.store.create("assemblyai", "Duplicate", [secret1]), /duplicate_credential/);
    assert.equal(f.store.list().length, 3);
    for (const secret of [secret1, secret2, secret3]) {
      assert.equal(JSON.stringify(f.store.list()).includes(secret), false);
      assert.equal(readFileSync(join(f.dir, "credentials.sqlite")).includes(Buffer.from(secret)), false);
    }
    const restart = new CredentialStore(f.dir, master, [f.config.outputDir, f.config.audioDir]);
    assert.equal(restart.resolve(pin), secret1); restart.close();
    const restoreDir = join(f.root, "restored-private"); mkdirSync(restoreDir, { mode: 0o700 });
    copyFileSync(join(f.dir, "credentials.sqlite"), join(restoreDir, "credentials.sqlite"));
    chmodSync(join(restoreDir, "credentials.sqlite"), 0o600);
    const restored = new CredentialStore(restoreDir, master, [f.config.outputDir]);
    assert.equal(restored.resolve(pin), secret1); assert.equal(restored.list().length, 3); restored.close();
    assert.throws(() => new CredentialStore(restoreDir, "cd".repeat(32), [f.config.outputDir]), /credential_store_locked/);
  } finally { f.cleanup(); }
});

test("rotation pins old work; disable fails closed for new work; revoke invalidates every pin", () => {
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "Personal", [secret1]); f.store.select(a);
    const old = f.store.pin("deepgram")!;
    f.store.addKey(a, secret2);
    const current = f.store.pin("deepgram")!;
    assert.equal(f.store.resolve(old), secret1); assert.equal(f.store.resolve(current), secret2);
    f.store.enable(a, false);
    assert.throws(() => f.store.pin("deepgram"), /selected_account_unavailable/);
    assert.equal(f.store.resolve(old), secret1);
    f.store.revoke(a, old.credentialId);
    assert.throws(() => f.store.resolve(old), /credential_revoked_local/);
    assert.throws(() => f.store.useKey(a, old.credentialId), /credential_unavailable/);
    assert.equal(f.store.list()[0]!.balance.state, "unknown");
    f.store.useLegacy("deepgram"); assert.equal(f.store.pin("deepgram"), undefined);
  } finally { f.cleanup(); }
});

test("private storage refuses public overlap, symlinks, weak permissions and altered ciphertext", () => {
  const f = fixture();
  try {
    assert.throws(() => new CredentialStore(join(f.config.outputDir, "keys"), master, [f.config.outputDir]), /overlaps_exports/);
    const link = join(f.root, "linked"); symlinkSync(f.dir, link);
    assert.throws(() => new CredentialStore(link, master, [f.config.outputDir]), /symlink/);
    const open = join(f.root, "open"); mkdirSync(open, { mode: 0o755 }); chmodSync(open, 0o755);
    assert.throws(() => new CredentialStore(open, master, [f.config.outputDir]), /permissions/);
    const a = f.store.create("deepgram", "Personal", [secret1]); f.store.select(a); const pin = f.store.pin("deepgram")!;
    const db = new DatabaseSync(join(f.dir, "credentials.sqlite"));
    db.prepare("UPDATE credentials SET sealed='invalid' WHERE id=?").run(pin.credentialId); db.close();
    assert.throws(() => f.store.resolve(pin), /credential_store_locked/);
  } finally { f.cleanup(); }
});

test("every RunManager entry pins live provider/account; later defaults cannot redirect queued work", async () => {
  const f = fixture();
  try {
    const a = f.store.create("deepgram", "First", [secret1]); f.store.select(a);
    const other = f.store.create("openai_whisper", "Second provider", [secret3]); f.store.select(other);
    let effective = f.config;
    const observed: string[] = [];
    const manager = new RunManager(f.config, { persistRuns: false, maxBufferedEventsPerRun: 10,
      credentialStore: f.store, effectiveConfig: () => effective,
      deps: { runPipeline: async (_input, config, options) => {
        options.assertCredentialAvailable?.(); observed.push(config.deepgramApiKey ?? config.openaiApiKey ?? "");
        assert.equal(config.deepgramApiKeys, undefined);
      } } });
    const requests = [{ url: "https://www.youtube.com/watch?v=synthetic" },
      { audioId: "upload", audioPath: "/synthetic.wav" }, { audioId: "intake", audioPath: "/synthetic.wav", intakeId: "int_synthetic" }];
    const runs = requests.map((request) => manager.createRun(request));
    f.store.addKey(a, secret2);
    effective = { ...f.config, sttProvider: "openai_whisper" };
    runs.forEach((run, index) => manager.startRun(run.runId, requests[index]!));
    await manager.waitForIdle(1000);
    assert.deepEqual(observed, [secret1, secret1, secret1]);
    const next = manager.createRun(requests[0]!); manager.startRun(next.runId, requests[0]!); await manager.waitForIdle(1000);
    assert.equal(observed[3], secret3);
    const queued = manager.createRun(requests[0]!);
    const pin = f.store.workSelection(`run:${queued.runId}`)!.pin!;
    assert.equal(JSON.stringify(manager.listRuns()).includes(pin.credentialId), false);
    f.store.revoke(pin.accountId, pin.credentialId);
    assert.equal(manager.revokeCredential(pin.credentialId), 1);
    assert.equal(manager.getRun(queued.runId)?.status, "cancelled");
    assert.throws(() => manager.createRun(requests[0]!), /selected_account_unavailable/);
  } finally { f.cleanup(); }
});

test("intake admission persists an opaque pin across database reopen and duplicate delivery", () => {
  const f = fixture(); let jobs: MediaJobStore | undefined;
  try {
    const a = f.store.create("deepgram", "First", [secret1]); f.store.select(a);
    const pin = f.store.pin("deepgram")!;
    jobs = new MediaJobStore(f.config.outputDir, (intakeId) => f.store.recordWork(`intake:${intakeId}`, "deepgram", f.store.pin("deepgram")));
    const request = { schemaVersion: "media2text.intake.v1" as const, eventId: "synthetic-event", idempotencyKey: "synthetic-idempotency",
      source: { authority: "plaud", itemId: "synthetic", artifactRevision: `sha256:${"a".repeat(64)}` },
      artifact: { url: "https://artifacts.example.test/synthetic.wav", contentType: "audio/wav" } };
    const accepted = jobs.createIntake(request as Parameters<MediaJobStore["createIntake"]>[0]);
    f.store.addKey(a, secret2);
    assert.equal(jobs.createIntake(request as Parameters<MediaJobStore["createIntake"]>[0]).deduplicated, true);
    assert.deepEqual(f.store.workSelection(`intake:${accepted.record.intakeId}`)?.pin, pin);
    jobs.close(); jobs = new MediaJobStore(f.config.outputDir);
    assert.ok(jobs.getIntake(accepted.record.intakeId));
    assert.deepEqual(f.store.workSelection(`intake:${accepted.record.intakeId}`)?.pin, pin);
    assert.equal(JSON.stringify(jobs.getIntake(accepted.record.intakeId)).includes(pin.credentialId), false);
    assert.equal(readFileSync(jobs.dbPath).includes(Buffer.from(secret1)), false);
  } finally { jobs?.close(); f.cleanup(); }
});

test("a rolled-back new intake refreshes its private pin on readmission; duplicates retain it", () => {
  const f = fixture(); let jobs: MediaJobStore | undefined;
  try {
    const first = f.store.create("deepgram", "First", [secret1]); f.store.select(first);
    let rejectOnce = true;
    jobs = new MediaJobStore(f.config.outputDir, (id) => {
      f.store.recordWork(`intake:${id}`, "deepgram", f.store.pin("deepgram"));
      if (rejectOnce) { rejectOnce = false; throw new Error("synthetic admission rollback"); }
    });
    const request = { schemaVersion: "media2text.intake.v1" as const, eventId: "rollback-event", idempotencyKey: "rollback-id",
      source: { authority: "plaud", itemId: "rollback", artifactRevision: `sha256:${"b".repeat(64)}` },
      artifact: { url: "https://artifacts.example.test/synthetic.wav", contentType: "audio/wav" } };
    const admit = () => jobs!.createIntake(request as Parameters<MediaJobStore["createIntake"]>[0]);
    assert.throws(admit, /synthetic admission rollback/);
    const second = f.store.create("deepgram", "Second", [secret2]); f.store.select(second);
    const accepted = admit(); assert.equal(accepted.deduplicated, false);
    assert.equal(f.store.workSelection(`intake:${accepted.record.intakeId}`)?.pin?.accountId, second);
    f.store.select(first); assert.equal(admit().deduplicated, true);
    assert.equal(f.store.workSelection(`intake:${accepted.record.intakeId}`)?.pin?.accountId, second);
  } finally { jobs?.close(); f.cleanup(); }
});

test("revocation stops optional AssemblyAI credit checks before any provider access", async () => {
  const config = configSchema.parse({ assemblyAiApiKey: secret1, assemblyAiCreditsCheck: "warn" });
  let calls = 0;
  await assert.rejects(checkAssemblyAiCredits(config, () => { calls++; throw new Error("provider must not be constructed"); },
    () => { throw new Error("credential_revoked_local"); }), /credential_revoked_local/);
  assert.equal(calls, 0);
});

test("media subprocesses do not inherit credential-store bootstrap secrets", async () => {
  const previous = { ...process.env };
  try {
    process.env.Y2T_CREDENTIAL_MASTER_KEY = master; process.env.Y2T_CREDENTIAL_ADMIN_PROOF_SECRET = "cd".repeat(32);
    const result = await execCommand(process.execPath, ["-e", "console.log(JSON.stringify([!!process.env.Y2T_CREDENTIAL_MASTER_KEY,!!process.env.Y2T_CREDENTIAL_ADMIN_PROOF_SECRET,!!process.env.PATH]))"]);
    assert.deepEqual(JSON.parse(result.stdout), [false, false, true]);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("admin proofs reject wrong bodies, roles and expired or future windows", () => {
  const key = "operator-key-synthetic-32-characters"; const now = Date.now();
  const proof = signAdminProof("original", key, now);
  assert.equal(verifyAdminProof("original", proof, key, now), true);
  assert.equal(verifyAdminProof("modified", proof, key, now), false);
  assert.equal(verifyAdminProof("original", proof, "intake-key-synthetic", now), false);
  assert.equal(verifyAdminProof("original", proof, key, now + 31_000), false);
  assert.equal(verifyAdminProof("original", proof, key, now - 31_000), false);
});

test("access checks use fixed nonbillable GETs, forbid redirects and distinguish billing uncertainty", async () => {
  for (const [status, state] of [[200, "accepted"], [401, "rejected"], [403, "permission_unknown"], [500, "unavailable"]] as const) {
    const check = await probeCredential("deepgram", secret1, async (url, options) => {
      assert.equal(url, "https://api.deepgram.com/v1/projects"); assert.equal(options?.method, "GET");
      assert.equal(options?.redirect, "error"); assert.equal(options?.body, undefined);
      return new Response("", { status });
    });
    assert.equal(check.state, state); assert.equal("balance" in check, false);
  }
  assert.equal((await probeCredential("openai_whisper", secret1, async () => { throw new Error(secret1); })).state, "unavailable");
});

test("credential BFF requires fresh authentication and origin, bounds input and strips caller proof", async () => {
  const previous = { ...process.env }; const fetchBefore = globalThis.fetch;
  Object.assign(process.env, { Y2T_WEB_AUTH_SECRET: "web-auth-secret-for-synthetic-tests-32", Y2T_WEB_AUTH_PASSPHRASE: "synthetic-passphrase",
    Y2T_API_KEY: "operator-key-synthetic-32-characters", Y2T_CREDENTIAL_ADMIN_PROOF_SECRET: "ef".repeat(32), Y2T_API_BASE_URL: "http://api.example.test" });
  let calls = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      calls++;
      const headers = new Headers(options?.headers);
      assert.equal(headers.get("x-m2t-admin-proof") === "forged", false);
      const sent = options?.body instanceof ArrayBuffer ? new Uint8Array(options.body) : options?.body as string;
      assert.equal(verifyAdminProof(sent, headers.get("x-m2t-admin-proof")!, process.env.Y2T_CREDENTIAL_ADMIN_PROOF_SECRET), true);
      return Response.json({ accounts: [] });
    };
    const fresh = await issueWebSessionToken(); const stale = await issueWebSessionToken(Date.now() - 301_000);
    const request = (session?: string, origin = "https://console.test", body = '{"action":"create"}') => new Request("https://console.test/api/provider-accounts", {
      method: "POST", headers: { origin, cookie: session ? `${WEB_SESSION_COOKIE}=${session}` : "", "x-m2t-admin-proof": "forged" }, body });
    assert.equal((await proxyCredentials(request())).status, 401);
    assert.equal((await proxyCredentials(request(stale))).status, 403);
    assert.equal((await proxyCredentials(request(fresh, "https://attacker.test"))).status, 403);
    assert.equal((await proxyCredentials(request(fresh, undefined, "x".repeat(16_385)))).status, 413);
    assert.equal(calls, 0);
    assert.equal((await proxyCredentials(request(fresh))).status, 200); assert.equal(calls, 1);
    process.env.Y2T_WEB_AUTH_SECRET = process.env.Y2T_CREDENTIAL_ADMIN_PROOF_SECRET;
    assert.equal((await proxyCredentials(request(await issueWebSessionToken()))).status, 503);
    assert.equal(calls, 1, "a shared proof/session secret must never reach the API");
  } finally {
    globalThis.fetch = fetchBefore;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("real account API rejects machine roles, unsigned writes and proof replay; admission fails closed", async () => {
  const f = fixture(); const previous = { ...process.env };
  const proofSecret = "ef".repeat(32);
  Object.assign(process.env, { Y2T_API_KEY: "synthetic-operator-key-0000000000000000",
    Y2T_INTAKE_API_KEY: "synthetic-intake-key-11111111111111111",
    Y2T_CORTEX_TRANSCRIPT_READ_KEY: "synthetic-reader-key-2222222222222222",
    Y2T_CREDENTIALS_DIR: f.dir, Y2T_CREDENTIAL_MASTER_KEY: master,
    Y2T_CREDENTIAL_ADMIN_PROOF_SECRET: proofSecret, Y2T_INTAKE_WORKER_ENABLED: "false" });
  let server: Awaited<ReturnType<typeof startApiServer>>["server"] | undefined;
  try {
    ({ server } = await startApiServer(f.config, { host: "127.0.0.1", port: 0, persistRuns: false, maxBufferedEventsPerRun: 10 }));
    if (!server.listening) await new Promise<void>((resolve) => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    for (const headers of [{}, { "x-api-key": process.env.Y2T_INTAKE_API_KEY },
      { "x-api-key": process.env.Y2T_CORTEX_TRANSCRIPT_READ_KEY }, { "x-media2text-intake-key": process.env.Y2T_INTAKE_API_KEY }]) {
      assert.equal((await fetch(`${base}/provider-accounts`, { headers })).status, 401);
    }
    const headers = { "x-api-key": process.env.Y2T_API_KEY, "content-type": "application/json" };
    const body = JSON.stringify({ action: "create", provider: "deepgram", label: "Viaje · Málaga", token: secret1 });
    assert.equal((await fetch(`${base}/provider-accounts`, { method: "POST", headers, body })).status, 403);
    const signed = { ...headers, "x-m2t-admin-proof": signAdminProof(body, proofSecret) };
    const created = await fetch(`${base}/provider-accounts`, { method: "POST", headers: signed, body });
    assert.equal(created.status, 200); assert.equal(created.headers.get("cache-control"), "no-store");
    const saved = await created.json() as { accountId: string; accounts: { label: string }[]; selectedAccountId: string | null };
    assert.equal(saved.accounts[0]!.label, "Viaje · Málaga"); assert.equal(saved.selectedAccountId, null);
    assert.equal(JSON.stringify(saved).includes(secret1), false);
    assert.equal((await fetch(`${base}/provider-accounts`, { method: "POST", headers: signed, body })).status, 403);
    const mutate = async (action: object) => {
      const body = JSON.stringify(action);
      return fetch(`${base}/provider-accounts`, { method: "POST", body, headers: { ...headers, "x-m2t-admin-proof": signAdminProof(body, proofSecret) } });
    };
    assert.equal((await mutate({ action: "select", accountId: saved.accountId })).status, 200);
    const intake = { schemaVersion: "media2text.intake.v1", eventId: "api-pinned-event", idempotencyKey: "api-pinned-id",
      source: { authority: "plaud-mirror", itemId: "synthetic-api-item", artifactRevision: `sha256:${"c".repeat(64)}` },
      artifact: { url: "https://source.example/synthetic.wav", contentType: "audio/wav", sha256: "c".repeat(64), bytes: 10 } };
    const admit = (data: object) => fetch(`${base}/v1/intakes`, { method: "POST", body: JSON.stringify(data),
      headers: { "content-type": "application/json", "x-media2text-intake-key": process.env.Y2T_INTAKE_API_KEY } });
    const accepted = await admit(intake); assert.equal(accepted.status, 202, await accepted.clone().text());
    const record = await accepted.json() as { intake: { intakeId: string } };
    assert.equal(f.store.workSelection(`intake:${record.intake.intakeId}`)?.pin?.accountId, saved.accountId);
    assert.equal((await mutate({ action: "enable", accountId: saved.accountId, enabled: false })).status, 200);
    assert.equal((await admit(intake)).status, 202, "duplicate retains accepted work despite disabled default");
    const denied = await admit({ ...intake, eventId: "new-event", idempotencyKey: "new-id", source: { ...intake.source, itemId: "new-item" } });
    assert.equal(denied.status, 409); assert.deepEqual(await denied.json(), { error: "selected_account_unavailable" });
    const oversized = "x".repeat(16_385);
    assert.equal((await fetch(`${base}/provider-accounts`, { method: "POST", headers, body: oversized })).status, 413);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous); f.cleanup();
  }
});

test("account handler uses socket peer and exact split UTF-8 bytes; probes remain rate limited", async () => {
  const f = fixture(); const previous = { ...process.env };
  const proofSecret = "ef".repeat(32); let probes = 0;
  Object.assign(process.env, { Y2T_API_KEY: "synthetic-operator-key-0000000000000000", Y2T_CREDENTIAL_ADMIN_PROOF_SECRET: proofSecret });
  const manager = new RunManager(f.config, { persistRuns: false, maxBufferedEventsPerRun: 10 });
  const route = credentialRoutes(f.store, f.config, manager, () => f.config, async () => {
    probes++; return { state: "accepted", checkedAt: new Date().toISOString() };
  });
  const call = async (input: object, peer = "127.0.0.1") => {
    const body = Buffer.from(JSON.stringify(input));
    const req = { method: "POST", socket: { remoteAddress: peer },
      headers: { "x-forwarded-for": "127.0.0.1", "x-m2t-admin-proof": signAdminProof(body, proofSecret) },
      async *[Symbol.asyncIterator]() { for (const byte of body) yield Buffer.from([byte]); } };
    const res = { statusCode: 200, body: "", setHeader() {}, end(body = "") { this.body = body; } };
    await route(req as unknown as IncomingMessage, res as unknown as ServerResponse); return res;
  };
  try {
    const action = { action: "create", provider: "deepgram", label: "Español · viaje", token: secret1 };
    assert.equal((await call(action, "10.0.0.9")).statusCode, 403);
    assert.equal((await call(action)).statusCode, 200);
    assert.equal(f.store.list()[0]!.label, "Español · viaje");
    for (let i = 0; i < 6; i++) assert.equal((await call({ action: "probe_unsaved", provider: "deepgram", token: secret2 })).statusCode, 200);
    assert.equal((await call({ action: "probe_unsaved", provider: "deepgram", token: secret2 })).statusCode, 429);
    assert.equal(probes, 6);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous); f.cleanup();
  }
});

test("revocation at start settles the run and cache reuse needs no valid account", async () => {
  const f = fixture(); let calls = 0;
  try {
    const account = f.store.create("deepgram", "Pinned", [secret1]); f.store.select(account);
    const manager = new RunManager(f.config, { credentialStore: f.store, persistRuns: false, maxBufferedEventsPerRun: 10,
      deps: { runPipeline: async () => { calls++; } } });
    const request = { url: "https://www.youtube.com/watch?v=synthetic" };
    const run = manager.createRun(request); const pin = f.store.pin("deepgram")!;
    f.store.revoke(account, pin.credentialId);
    manager.startRun(run.runId, request); await manager.waitForIdle(1000);
    assert.equal(manager.getRun(run.runId)?.error, "credential_revoked_local");
    assert.equal(manager.getRun(run.runId)?.status, "error"); assert.equal(calls, 0);
    const cached = manager.createCachedRun(request, { inputUrl: request.url, force: false, channelId: "cached", channelTitle: "Cached",
      totalVideos: 1, alreadyProcessed: 1, toProcess: 0, videos: [], filters: {} });
    assert.equal(cached.status, "done"); assert.equal(calls, 0);
  } finally { f.cleanup(); }
});

test("real intake worker keeps admitted account after rotation and stops revoked queued work", async () => {
  const f = fixture(); let jobs: MediaJobStore | undefined; let worker: IntakeWorker | undefined;
  const previous = process.env.Y2T_INTAKE_WORKER_ENABLED; process.env.Y2T_INTAKE_WORKER_ENABLED = "true";
  try {
    const account = f.store.create("deepgram", "Pinned", [secret1]); f.store.select(account);
    jobs = new MediaJobStore(f.config.outputDir, (id) => f.store.recordWork(`intake:${id}`, "deepgram", f.store.pin("deepgram")));
    let observed: string | undefined;
    const manager = new RunManager(f.config, { credentialStore: f.store, persistRuns: false, maxBufferedEventsPerRun: 10,
      deps: { runPipeline: async (_input, config) => { observed = config.deepgramApiKey; } } });
    const prepare = (id: string) => {
      const accepted = jobs!.createIntake({ schemaVersion: "media2text.intake.v1", eventId: id, idempotencyKey: id,
        source: { authority: "plaud-mirror", itemId: id, artifactRevision: `sha256:${"a".repeat(64)}` },
        artifact: { url: "https://source.example/synthetic.wav", contentType: "audio/wav" } });
      const leased = jobs!.leaseNextIntake("test-owner", 60_000)!;
      assert.equal(leased.intakeId, accepted.record.intakeId);
      jobs!.markIntakeReady(leased.intakeId, "test-owner", "/synthetic.wav"); return leased.intakeId;
    };
    prepare("first-pinned"); f.store.addKey(account, secret2);
    worker = new IntakeWorker(jobs, manager, f.config, (id) => f.store.workSelection(`intake:${id}`));
    worker.start(); await worker.tick(); worker.stop(); await manager.waitForIdle(1000);
    assert.equal(observed, secret1);
    const second = prepare("second-revoked"); const current = f.store.pin("deepgram")!;
    f.store.revoke(account, current.credentialId); observed = undefined;
    worker.start(); await worker.tick(); worker.stop();
    assert.equal(observed, undefined);
    assert.equal(jobs.getIntake(second)?.lastErrorCode, "credential_revoked_local");
  } finally {
    worker?.stop(); jobs?.close(); f.cleanup();
    if (previous === undefined) delete process.env.Y2T_INTAKE_WORKER_ENABLED; else process.env.Y2T_INTAKE_WORKER_ENABLED = previous;
  }
});

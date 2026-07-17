import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startApiServer } from "../src/api/server.js";
import { configSchema } from "../src/config/schema.js";
import { getBuildVersion } from "../src/utils/version.js";
import {
  adaptTranscriptionIntake,
  transcriptionIntakeRequestSchema,
} from "../src/jobs/transcriptionProfile.js";

async function listen(server: any): Promise<number> {
  if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
  return (server.address() as { port: number }).port;
}

test("Plaud compatibility facade scopes auth, identity, admission, and pull status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "y2t-plaud-profile-"));
  const env = snapshotEnv([
    "Y2T_API_KEY",
    "Y2T_INTAKE_WORKER_ENABLED",
    "Y2T_INTAKE_STATUS_OUTBOX_ENABLED",
    "Y2T_TRANSCRIPTION_INTAKE_PROFILES_JSON",
  ]);
  process.env.Y2T_API_KEY = "operator-api-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.Y2T_INTAKE_WORKER_ENABLED = "false";
  process.env.Y2T_INTAKE_STATUS_OUTBOX_ENABLED = "false";
  process.env.Y2T_TRANSCRIPTION_INTAKE_PROFILES_JSON = JSON.stringify([{
    id: "plaud-primary",
    authority: "plaud-mirror",
    intakeBearer: "plaud-intake-bearer-aaaaaaaaaaaaaaaaaaaaaaaa",
    artifactBearer: "plaud-artifact-bearer-bbbbbbbbbbbbbbbbbbbbb",
    statusHmacSecret: "plaud-status-secret-cccccccccccccccccccccccc",
    artifactOrigins: ["https://plaud.example"],
    callbackOrigins: ["https://plaud.example"],
  }]);
  const config = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir: join(dir, "output"),
    audioDir: join(dir, "audio"),
  });
  const { server } = await startApiServer(config, {
    host: "127.0.0.1",
    port: 0,
    maxBufferedEventsPerRun: 10,
    persistRuns: false,
  });
  const port = await listen(server);
  const bearer = "Bearer plaud-intake-bearer-aaaaaaaaaaaaaaaaaaaaaaaa";
  const digest = "a".repeat(64);
  const request = {
    schemaVersion: "transcription.intake.v1",
    eventId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "plaud:item-1:revision-1",
    correlationId: "plaud-canary-1",
    source: {
      authority: "plaud-mirror",
      collectionId: "workspace-one",
      itemId: "item-1",
      artifactRevision: `sha256:${digest}`,
    },
    artifact: {
      url: "https://plaud.example/api/transcription/artifacts/destination/hash",
      accessProfile: "bearer",
      sha256: digest,
      bytes: 10,
      contentType: "audio/mpeg",
      filename: "item-1.mp3",
      durationSeconds: 3,
    },
    callback: {
      url: "https://plaud.example/api/transcription/status/destination",
      authentication: "hmac-sha256-v1",
    },
    title: "Item 1",
    createdAt: "2026-07-17T00:00:00.000Z",
  };

  const adapted = adaptTranscriptionIntake(transcriptionIntakeRequestSchema.parse(request));
  assert.equal(adapted.source.createdAt, request.createdAt);
  assert.equal(adapted.source.createdAtType, "recorded");

  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/intake-capabilities`)).status, 401);
    const capabilities = await fetch(`http://127.0.0.1:${port}/v1/intake-capabilities`, {
      headers: { authorization: bearer },
    });
    assert.equal(capabilities.status, 200);
    assert.deepEqual(await capabilities.json(), {
      schemaVersion: "transcription.intake-capabilities.v1",
      provider: { name: "Media2Text", version: await getBuildVersion() },
      intakeContract: "transcription.intake.v1",
      statusContract: "transcription.intake-status.v1",
      statusPush: true,
      statusPull: true,
    });

    const admitted = await post(port, bearer, request);
    assert.equal(admitted.response.status, 202);
    assert.deepEqual(Object.keys(admitted.body).sort(), [
      "deduplicated",
      "intakeId",
      "schemaVersion",
      "status",
    ]);
    assert.equal(admitted.body.schemaVersion, "transcription.intake-admission.v1");
    assert.equal(admitted.body.status, "accepted");
    assert.equal(admitted.body.deduplicated, false);

    const duplicate = await post(port, bearer, request);
    assert.equal(duplicate.response.status, 202);
    assert.equal(duplicate.body.intakeId, admitted.body.intakeId);
    assert.equal(duplicate.body.deduplicated, true);

    const conflict = await post(port, bearer, { ...request, title: "Changed" });
    assert.equal(conflict.response.status, 409);

    const otherCollection = await post(port, bearer, {
      ...request,
      eventId: "22222222-2222-4222-8222-222222222222",
      idempotencyKey: "plaud:item-1:revision-1:other-workspace",
      source: { ...request.source, collectionId: "workspace-two" },
    });
    assert.equal(otherCollection.response.status, 202);
    assert.notEqual(otherCollection.body.intakeId, admitted.body.intakeId);

    const status = await fetch(
      `http://127.0.0.1:${port}/v1/intakes/${admitted.body.intakeId}`,
      { headers: { authorization: bearer } }
    );
    assert.equal(status.status, 200);
    const statusBody = await status.json() as any;
    assert.equal(statusBody.schemaVersion, "transcription.intake-status.v1");
    assert.deepEqual(statusBody.source, request.source);
    assert.equal(statusBody.status, "accepted");
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/v1/intakes/${admitted.body.intakeId}`, {
        headers: { authorization: "Bearer wrong-credential-aaaaaaaaaaaaaaaaaaaaaaaa" },
      })).status,
      401
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
    restoreEnv(env);
  }
});

async function post(port: number, bearer: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/intakes`, {
    method: "POST",
    headers: { authorization: bearer, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() as any };
}

function snapshotEnv(names: string[]): Map<string, string | undefined> {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot: Map<string, string | undefined>): void {
  for (const [name, value] of snapshot) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

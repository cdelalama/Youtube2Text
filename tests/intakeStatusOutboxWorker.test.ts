import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { IntakeStatusOutboxWorker } from "../src/jobs/intakeStatusOutboxWorker.js";
import { MediaJobStore, type IntakeRequestV1 } from "../src/jobs/store.js";
import { canonicalJson } from "../src/transcripts/store.js";

async function waitUntil(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("intake status outbox signs and delivers producer callbacks durably", async () => {
  const dir = await mkdtemp(join(tmpdir(), "y2t-intake-status-outbox-"));
  const previous = process.env.Y2T_TRANSCRIPTION_INTAKE_PROFILES_JSON;
  const secret = "plaud-status-secret-cccccccccccccccccccccccc";
  process.env.Y2T_TRANSCRIPTION_INTAKE_PROFILES_JSON = JSON.stringify([{
    id: "plaud-primary",
    authority: "plaud-mirror",
    intakeBearer: "plaud-intake-bearer-aaaaaaaaaaaaaaaaaaaaaaaa",
    artifactBearer: "plaud-artifact-bearer-bbbbbbbbbbbbbbbbbbbbb",
    statusHmacSecret: secret,
    artifactOrigins: ["https://plaud.example"],
    callbackOrigins: ["https://plaud.example"],
  }]);
  const store = new MediaJobStore(dir);
  const digest = "a".repeat(64);
  const request: IntakeRequestV1 = {
    schemaVersion: "media2text.intake.v1",
    eventId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "plaud:item-1:revision-1",
    source: {
      authority: "plaud-mirror",
      collectionId: "workspace-one",
      itemId: "item-1",
      artifactRevision: `sha256:${digest}`,
    },
    artifact: {
      url: "https://plaud.example/api/transcription/artifacts/destination/hash",
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
  };
  const intake = store.createIntake(request).record;
  const [event] = store.listIntakeStatusOutbox(intake.intakeId);
  assert.ok(event);
  let target = "";
  let sent: RequestInit | undefined;
  const worker = new IntakeStatusOutboxWorker(store, {
    fetch: async (url, init) => {
      target = String(url);
      sent = init;
      return new Response("", { status: 202 });
    },
  });

  try {
    worker.start();
    await waitUntil(() => store.getIntakeStatusOutbox(event.eventId)?.status === "delivered");
    assert.equal(target, request.callback?.url);
    const headers = new Headers(sent?.headers);
    const timestamp = headers.get("x-transcription-timestamp");
    const body = String(sent?.body);
    assert.ok(timestamp);
    assert.equal(
      headers.get("x-transcription-signature"),
      `sha256=${createHmac("sha256", secret).update(`${timestamp}.${canonicalJson(JSON.parse(body))}`).digest("hex")}`
    );
    const payload = JSON.parse(body);
    assert.equal(payload.schemaVersion, "transcription.intake-status.v1");
    assert.equal(payload.eventType, "intake.status");
    assert.equal(payload.status, "accepted");
    assert.deepEqual(payload.source, request.source);
  } finally {
    worker.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.Y2T_TRANSCRIPTION_INTAKE_PROFILES_JSON;
    else process.env.Y2T_TRANSCRIPTION_INTAKE_PROFILES_JSON = previous;
  }
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MediaJobStore } from "../src/jobs/store.js";
import { TranscriptReadyOutboxWorker } from "../src/jobs/outboxWorker.js";
import type { StoredTranscript } from "../src/transcripts/store.js";

async function waitUntil(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("TranscriptReadyOutboxWorker signs and delivers a durable item event", async () => {
  const dir = await mkdtemp(join(tmpdir(), "y2t-outbox-worker-"));
  const previousUrl = process.env.Y2T_TRANSCRIPT_READY_URL;
  const previousSecret = process.env.Y2T_TRANSCRIPT_READY_SECRET;
  const previousKeyId = process.env.Y2T_TRANSCRIPT_READY_KEY_ID;
  process.env.Y2T_TRANSCRIPT_READY_URL = "https://cortex.example/hooks/media2text";
  process.env.Y2T_TRANSCRIPT_READY_SECRET = "outbox-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.Y2T_TRANSCRIPT_READY_KEY_ID = "cortex-2026-07";
  const store = new MediaJobStore(dir);
  const transcriptId = `trn_${"a".repeat(64)}`;
  const stored = {
    created: true,
    recordSha256: "b".repeat(64),
    bytes: 100,
    relativePath: "fixture.json",
    record: {
      schemaVersion: "media2text.transcript.v1",
      transcriptId,
      createdAt: "2026-07-15T00:00:00.000Z",
      producer: { name: "Media2Text", technicalId: "youtube2text", version: "0.38.0" },
      correlation: { runId: "run-1" },
      source: {
        kind: "youtube",
        authority: "youtube",
        sourceItemId: "video-1",
        title: "Video 1",
        artifactRevision: `sha256:${"c".repeat(64)}`,
      },
      artifact: { sha256: "c".repeat(64), bytes: 10, durationSeconds: 2, contentType: "audio/mpeg" },
      transcription: {
        provider: "deepgram",
        model: "nova-3",
        payloadSha256: "d".repeat(64),
        payload: { id: "provider-1", status: "completed", text: "hello" },
      },
      representations: [],
    },
  } satisfies StoredTranscript;
  const event = store.enqueueTranscriptReady(stored);
  assert.ok(event);
  let request: RequestInit | undefined;
  const worker = new TranscriptReadyOutboxWorker(store, {
    fetch: async (_url, init) => {
      request = init;
      return new Response("", { status: 202 });
    },
  });
  try {
    worker.start();
    await waitUntil(() => store.getOutbox(event.eventId)?.status === "delivered");
    const headers = new Headers(request?.headers);
    assert.equal(headers.get("x-media2text-event"), "transcript.ready");
    assert.equal(headers.get("x-media2text-event-id"), event.eventId);
    assert.equal(headers.get("x-media2text-key-id"), "cortex-2026-07");
    assert.equal(headers.get("x-media2text-signature-version"), "hmac-sha256-v1");
    assert.match(headers.get("x-media2text-signature") ?? "", /^sha256=[a-f0-9]{64}$/);
    assert.equal(JSON.parse(String(request?.body)).transcript.transcriptId, transcriptId);
  } finally {
    worker.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
    if (previousUrl === undefined) delete process.env.Y2T_TRANSCRIPT_READY_URL;
    else process.env.Y2T_TRANSCRIPT_READY_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.Y2T_TRANSCRIPT_READY_SECRET;
    else process.env.Y2T_TRANSCRIPT_READY_SECRET = previousSecret;
    if (previousKeyId === undefined) delete process.env.Y2T_TRANSCRIPT_READY_KEY_ID;
    else process.env.Y2T_TRANSCRIPT_READY_KEY_ID = previousKeyId;
  }
});

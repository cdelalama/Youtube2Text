import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  IntakeConflictError,
  MediaJobStore,
  type IntakeRequestV1,
} from "../src/jobs/store.js";
import type { StoredTranscript } from "../src/transcripts/store.js";

function request(): IntakeRequestV1 {
  const digest = "a".repeat(64);
  return {
    schemaVersion: "media2text.intake.v1",
    eventId: "evt-source-1",
    idempotencyKey: "source:item-1:revision-1",
    correlationId: "corr-1",
    source: {
      authority: "plaud-mirror",
      itemId: "item-1",
      collectionId: "recordings",
      artifactRevision: `sha256:${digest}`,
    },
    artifact: {
      url: "https://source.example/artifacts/item-1",
      sha256: digest,
      bytes: 10,
      contentType: "audio/mpeg",
      durationSeconds: 3,
      filename: "item-1.mp3",
    },
    title: "Item 1",
  };
}

function storedTranscript(): StoredTranscript {
  const transcriptId = `trn_${"b".repeat(64)}`;
  return {
    created: true,
    recordSha256: "c".repeat(64),
    bytes: 123,
    relativePath: `_transcripts/v1/bb/${transcriptId}.json`,
    record: {
      schemaVersion: "media2text.transcript.v1",
      transcriptId,
      createdAt: "2026-07-15T00:00:00.000Z",
      producer: { name: "Media2Text", technicalId: "youtube2text", version: "0.38.0" },
      correlation: { runId: "run-1", intakeId: `int_${"d".repeat(64)}` },
      source: {
        kind: "intake",
        authority: "plaud-mirror",
        sourceItemId: "item-1",
        title: "Item 1",
        artifactRevision: `sha256:${"a".repeat(64)}`,
      },
      artifact: {
        sha256: "a".repeat(64),
        bytes: 10,
        durationSeconds: 3,
        contentType: "audio/mpeg",
      },
      transcription: {
        provider: "deepgram",
        model: "nova-3",
        payloadSha256: "e".repeat(64),
        payload: { id: "provider-1", status: "completed", text: "hello" },
      },
      representations: [],
    },
  };
}

test("MediaJobStore durably deduplicates intakes and rejects conflicting reuse", async () => {
  const dir = await mkdtemp(join(tmpdir(), "y2t-jobs-"));
  const store = new MediaJobStore(dir);
  try {
    const first = store.createIntake(request(), "2026-07-15T00:00:00.000Z");
    const duplicate = store.createIntake(request(), "2026-07-15T00:01:00.000Z");
    assert.equal(first.deduplicated, false);
    assert.equal(duplicate.deduplicated, true);
    assert.equal(duplicate.record.intakeId, first.record.intakeId);
    assert.throws(
      () =>
        store.createIntake({
          ...request(),
          artifact: { ...request().artifact, url: "https://source.example/changed" },
        }),
      IntakeConflictError
    );

    const owner = "worker-1";
    const leased = store.leaseNextIntake(owner, 1);
    assert.equal(leased?.status, "fetching");
    assert.equal(store.recoverExpiredIntakes("9999-01-01T00:00:00.000Z"), 1);
    assert.equal(store.getIntake(first.record.intakeId)?.status, "accepted");
    const retry = store.leaseNextIntake("worker-2", 60_000);
    assert.ok(retry);
    store.markIntakeFailed(retry.intakeId, "worker-2", "fetching", "test", "test");
    assert.equal(
      store.pruneTerminal({ nowMs: Date.now() + 366 * 86_400_000 }).intakesDeleted,
      1
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("MediaJobStore outbox is idempotent and recovers interrupted delivery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "y2t-outbox-store-"));
  const store = new MediaJobStore(dir);
  try {
    const first = store.enqueueTranscriptReady(storedTranscript());
    const duplicate = store.enqueueTranscriptReady(storedTranscript());
    assert.equal(duplicate.eventId, first.eventId);
    assert.equal(store.statusCounts().outbox.pending, 1);

    const leased = store.leaseNextOutbox("delivery-1", 1);
    assert.equal(leased?.status, "delivering");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(store.recoverExpiredOutbox(), 1);
    const leasedAgain = store.leaseNextOutbox("delivery-2", 60_000);
    assert.ok(leasedAgain);
    store.markOutboxDelivered(first.eventId, "delivery-2");
    assert.equal(store.getOutbox(first.eventId)?.status, "delivered");
    assert.equal(
      store.pruneTerminal({ nowMs: Date.now() + 366 * 86_400_000 }).outboxDeleted,
      1
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("intake fixture hashes are explicit", () => {
  assert.equal(createHash("sha256").update("fixture").digest("hex").length, 64);
});

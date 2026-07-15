import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson, TranscriptStore } from "../src/transcripts/store.js";

test("canonicalJson sorts object keys recursively", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: true, b: "x" }, list: [{ z: 2, a: 1 }] }),
    '{"a":{"b":"x","y":true},"list":[{"a":1,"z":2}],"z":1}\n'
  );
});

test("TranscriptStore writes immutable, byte-stable records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "y2t-transcript-store-"));
  const outputDir = join(dir, "output");
  const audioPath = join(dir, "audio.mp3");
  const txtPath = join(outputDir, "uploads", "item.txt");
  await mkdir(join(outputDir, "uploads"), { recursive: true });
  await writeFile(audioPath, "real-audio-bytes", "utf8");
  await writeFile(txtPath, "hello\n", "utf8");

  const store = new TranscriptStore(outputDir);
  const input = {
    createdAt: "2026-07-15T00:00:00.000Z",
    producerVersion: "0.38.0",
    runId: "run-1",
    source: {
      kind: "upload" as const,
      authority: "test",
      sourceItemId: "item-1",
      title: "Real fixture",
    },
    audioPath,
    durationSeconds: 12.5,
    contentType: "audio/mpeg",
    provider: "deepgram" as const,
    model: "nova-3",
    transcript: { id: "provider-1", status: "completed", text: "hello" },
    languageCode: "es",
    representations: [
      { format: "text" as const, absolutePath: txtPath, content: "hello\n" },
    ],
  };

  try {
    const first = await store.write(input);
    const second = await store.write({
      ...input,
      createdAt: "2026-07-16T00:00:00.000Z",
      runId: "run-2",
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.record.transcriptId, first.record.transcriptId);
    assert.equal(second.record.createdAt, first.record.createdAt);
    assert.equal(second.recordSha256, first.recordSha256);
    assert.match(first.record.transcriptId, /^trn_[a-f0-9]{64}$/);
    assert.match(first.record.source.artifactRevision, /^sha256:[a-f0-9]{64}$/);
    assert.equal(first.record.transcription.payload.text, "hello");
    assert.match(
      first.record.representations[0]?.relativePath ?? "",
      /^_transcripts\/v1\/[a-f0-9]{2}\/trn_[a-f0-9]{64}\/transcript\.txt$/
    );
    assert.equal(first.record.representations[0]?.legacyRelativePath, "uploads/item.txt");
    assert.equal(
      await readFile(join(outputDir, first.record.representations[0]!.relativePath), "utf8"),
      "hello\n"
    );

    const diskBytes = await readFile(join(outputDir, first.relativePath), "utf8");
    assert.equal(diskBytes, canonicalJson(first.record));

    const changed = await store.write({
      ...input,
      transcript: { id: "provider-2", status: "completed", text: "changed" },
    });
    assert.notEqual(changed.record.transcriptId, first.record.transcriptId);
    assert.equal((await store.list()).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

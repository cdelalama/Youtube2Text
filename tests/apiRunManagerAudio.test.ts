import test from "node:test";
import assert from "node:assert/strict";
import { RunManager } from "../src/api/runManager.js";
import { configSchema } from "../src/config/schema.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("RunManager passes audio input to pipeline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "y2t-run-audio-"));
  const config = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir: dir,
    audioDir: join(dir, "audio"),
  });

  let seenInput: any;
  const manager = new RunManager(config, {
    maxBufferedEventsPerRun: 10,
    persistRuns: false,
    deps: {
      runPipeline: async (input: any) => {
        seenInput = input;
      },
    },
  });

  const record = manager.createRun({
    audioId: "audio-123",
    audioPath: join(dir, "audio", "_uploads", "audio-123.mp3"),
    sourceArtifact: {
      path: join(dir, "audio", "_intakes", "audio-123.ogg"),
      artifactRevision: `sha256:${"a".repeat(64)}`,
      contentType: "audio/ogg",
      durationSeconds: 12,
    },
    audioTitle: "My audio",
    sourceCreatedAt: "2026-07-01T08:30:00.000Z",
    sourceCreatedAtType: "recorded",
  });
  manager.startRun(record.runId, {
    audioId: "audio-123",
    audioPath: join(dir, "audio", "_uploads", "audio-123.mp3"),
    sourceArtifact: {
      path: join(dir, "audio", "_intakes", "audio-123.ogg"),
      artifactRevision: `sha256:${"a".repeat(64)}`,
      contentType: "audio/ogg",
      durationSeconds: 12,
    },
    audioTitle: "My audio",
    sourceCreatedAt: "2026-07-01T08:30:00.000Z",
    sourceCreatedAtType: "recorded",
  });

  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  assert.equal(seenInput?.kind, "audio");
  assert.equal(seenInput?.audioId, "audio-123");
  assert.deepEqual(seenInput?.sourceArtifact, {
    path: join(dir, "audio", "_intakes", "audio-123.ogg"),
    artifactRevision: `sha256:${"a".repeat(64)}`,
    contentType: "audio/ogg",
    durationSeconds: 12,
  });
  assert.equal(seenInput?.sourceCreatedAt, "2026-07-01T08:30:00.000Z");
  assert.equal(seenInput?.sourceCreatedAtType, "recorded");
});

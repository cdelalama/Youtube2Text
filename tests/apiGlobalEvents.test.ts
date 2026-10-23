import test from "node:test";
import assert from "node:assert/strict";
import { RunManager } from "../src/api/runManager.js";

test("RunManager emits global run:created events", async () => {
  const manager = new RunManager(
    {
      sttProvider: "assemblyai",
      assemblyAiApiKey: "test",
      outputDir: "output",
      audioDir: "audio",
      filenameStyle: "title_id",
      audioFormat: "mp3",
      languageDetection: "auto",
      languageCode: "en_us",
      concurrency: 1,
      csvEnabled: false,
      assemblyAiCreditsCheck: "none",
      assemblyAiMinBalanceMinutes: 60,
      commentsEnabled: false,
      pollIntervalMs: 5000,
      maxPollMinutes: 60,
      downloadRetries: 0,
      transcriptionRetries: 0,
      ytDlpExtraArgs: [],
    },
    { maxBufferedEventsPerRun: 10, persistRuns: false },
  );
  await manager.init();

  manager.createRun({ url: "https://example.com", force: false });

  const events = manager.listGlobalEventsAfter(0);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event.type, "run:created");
  assert.ok(events[0]!.event.run.runId.length > 0);
});


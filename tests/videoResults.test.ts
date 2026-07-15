import test from "node:test";
import assert from "node:assert/strict";
import { RunManager } from "../src/api/runManager.js";
import type { PipelineEventEmitter } from "../src/pipeline/events.js";
import type { AppConfig } from "../src/config/schema.js";

function baseConfig(): AppConfig {
  return {
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
  } as any;
}

async function waitUntil(fn: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Timed out");
}

test("videoResults is populated from pipeline events", async () => {
  const fakeRunPipeline = async (
    inputUrl: string,
    _config: AppConfig,
    opts: { force: boolean; emitter?: PipelineEventEmitter; abortSignal?: AbortSignal }
  ) => {
    const emitter = opts.emitter;
    const ts = () => new Date().toISOString();

    emitter?.emit({
      type: "run:start",
      inputUrl,
      channelId: "UC_test",
      channelTitle: "Test Channel",
      totalVideos: 3,
      alreadyProcessed: 0,
      remaining: 3,
      timestamp: ts(),
    });

    emitter?.emit({
      type: "video:done",
      videoId: "vid1",
      basename: "vid1_title",
      transcriptId: `trn_${"a".repeat(64)}`,
      transcriptRecordSha256: "b".repeat(64),
      index: 1,
      total: 3,
      completed: 1,
      remaining: 2,
      timestamp: ts(),
    });

    emitter?.emit({
      type: "video:error",
      videoId: "vid2",
      basename: "vid2_title",
      error: "download failed",
      stage: "download",
      index: 2,
      total: 3,
      completed: 2,
      remaining: 1,
      timestamp: ts(),
    });

    emitter?.emit({
      type: "video:skip",
      videoId: "vid3",
      basename: "vid3_title",
      reason: "already_processed",
      index: 3,
      total: 3,
      completed: 3,
      remaining: 0,
      timestamp: ts(),
    });

    emitter?.emit({
      type: "run:done",
      channelId: "UC_test",
      total: 3,
      succeeded: 1,
      failed: 1,
      skipped: 1,
      timestamp: ts(),
    });
  };

  const manager = new RunManager(baseConfig(), {
    maxBufferedEventsPerRun: 100,
    persistRuns: false,
    deps: { runPipeline: fakeRunPipeline as any },
  });
  await manager.init();

  const run = manager.createRun({ url: "https://www.youtube.com/@test" });
  manager.startRun(run.runId, { url: run.inputUrl, force: false });

  await waitUntil(() => manager.getRun(run.runId)?.status === "done");
  const finished = manager.getRun(run.runId)!;

  assert.ok(Array.isArray(finished.videoResults), "videoResults should be an array");
  assert.equal(finished.videoResults!.length, 3);
  assert.deepEqual(finished.videoResults![0], {
    videoId: "vid1",
    basename: "vid1_title",
    status: "done",
    transcriptId: `trn_${"a".repeat(64)}`,
    transcriptRecordSha256: "b".repeat(64),
  });
  assert.deepEqual(finished.videoResults![1], { videoId: "vid2", basename: "vid2_title", status: "error" });
  assert.deepEqual(finished.videoResults![2], { videoId: "vid3", basename: "vid3_title", status: "skipped" });
});

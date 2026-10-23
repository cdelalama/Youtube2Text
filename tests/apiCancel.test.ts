import test from "node:test";
import assert from "node:assert/strict";
import { RunManager } from "../src/api/runManager.js";
import type { PipelineEventEmitter } from "../src/pipeline/events.js";
import type { AppConfig } from "../src/config/schema.js";

function baseConfig(): AppConfig {
  return {
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

test("RunManager.cancelRun cancels a queued run immediately", async () => {
  const manager = new RunManager(baseConfig(), { maxBufferedEventsPerRun: 10, persistRuns: false });
  await manager.init();

  const run = manager.createRun({ url: "https://example.com" });
  const cancelled = manager.cancelRun(run.runId);

  assert.ok(cancelled);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelRequested, true);
  assert.ok(cancelled.finishedAt);
});

test("RunManager.cancelRun requests cancellation and run becomes cancelled after pipeline emits run:cancelled", async () => {
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
      channelId: "UC123",
      channelTitle: "Chan",
      totalVideos: 1,
      alreadyProcessed: 0,
      remaining: 1,
      timestamp: ts(),
    });

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      emitter?.emit({
        type: "run:cancelled",
        channelId: "UC123",
        total: 1,
        succeeded: 0,
        failed: 0,
        skipped: 1,
        timestamp: ts(),
      });
    };

    if (opts.abortSignal?.aborted) {
      finish();
      return;
    }

    opts.abortSignal?.addEventListener(
      "abort",
      () => {
        finish();
      },
      { once: true }
    );

    await new Promise((r) => setTimeout(r, 50));
    finish();
  };

  const manager = new RunManager(baseConfig(), {
    maxBufferedEventsPerRun: 50,
    persistRuns: false,
    deps: { runPipeline: fakeRunPipeline as any },
  });
  await manager.init();

  const run = manager.createRun({ url: "https://example.com" });
  manager.startRun(run.runId, { url: run.inputUrl, force: false });

  const running = manager.getRun(run.runId)!;
  assert.equal(running.status, "running");

  const afterCancelRequest = manager.cancelRun(run.runId)!;
  assert.equal(afterCancelRequest.cancelRequested, true);
  assert.ok(
    afterCancelRequest.status === "running" || afterCancelRequest.status === "cancelled"
  );

  await waitUntil(() => manager.getRun(run.runId)?.status === "cancelled");
  const cancelled = manager.getRun(run.runId)!;
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.finishedAt);
  assert.deepEqual(cancelled.stats, { succeeded: 0, failed: 0, skipped: 1, total: 1 });
});

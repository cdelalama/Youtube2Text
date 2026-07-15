import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunManager } from "../src/api/runManager.js";
import { configSchema } from "../src/config/schema.js";
import type { PipelineEventEmitter } from "../src/pipeline/events.js";

async function waitForDone(manager: RunManager, runId: string): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (manager.getRun(runId)?.status === "done") return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("run did not finish");
}

test("run artifacts include only videos recorded by that run", async () => {
  const root = mkdtempSync(join(tmpdir(), "y2t-run-artifacts-"));
  const outputDir = join(root, "output");
  const channelDirName = "test-channel__UC_test";
  const channelDir = join(outputDir, channelDirName);
  mkdirSync(channelDir, { recursive: true });

  for (const [basename, videoId] of [["run-video", "vid-run"], ["other-video", "vid-other"]]) {
    writeFileSync(join(channelDir, `${basename}.json`), JSON.stringify({ id: videoId, status: "completed" }));
    writeFileSync(join(channelDir, `${basename}.meta.json`), JSON.stringify({ videoId, title: basename }));
  }

  const config = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir,
    audioDir: join(root, "audio"),
  });
  const fakePipeline = async (
    inputUrl: string,
    _config: typeof config,
    options: { emitter?: PipelineEventEmitter }
  ) => {
    const timestamp = new Date().toISOString();
    options.emitter?.emit({
      type: "run:start",
      inputUrl,
      channelId: "UC_test",
      channelTitle: "Test Channel",
      channelDirName,
      totalVideos: 1,
      alreadyProcessed: 0,
      remaining: 1,
      timestamp,
    });
    options.emitter?.emit({
      type: "video:done",
      videoId: "vid-run",
      basename: "run-video",
      transcriptId: `trn_${"a".repeat(64)}`,
      transcriptRecordSha256: "b".repeat(64),
      index: 1,
      total: 1,
      completed: 1,
      remaining: 0,
      timestamp,
    });
    options.emitter?.emit({
      type: "run:done",
      channelId: "UC_test",
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      timestamp,
    });
  };

  const manager = new RunManager(config, {
    maxBufferedEventsPerRun: 20,
    persistRuns: false,
    deps: { runPipeline: fakePipeline as never },
  });
  await manager.init();
  const run = manager.createRun({ url: "https://www.youtube.com/@test" });
  manager.startRun(run.runId, { url: run.inputUrl });
  await waitForDone(manager, run.runId);

  const artifacts = await manager.listArtifacts(run.runId);
  assert.deepEqual(artifacts.videos.map((video) => video.videoId), ["vid-run"]);
});

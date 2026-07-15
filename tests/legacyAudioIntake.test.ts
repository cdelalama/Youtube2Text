import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startApiServer } from "../src/api/server.js";
import { configSchema } from "../src/config/schema.js";
import type { PipelineEventEmitter } from "../src/pipeline/events.js";

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("legacy /audio and audio-backed /runs use the intake state machine", async () => {
  const dir = await mkdtemp(join(tmpdir(), "y2t-legacy-intake-"));
  const previousApiKey = process.env.Y2T_API_KEY;
  const previousWorker = process.env.Y2T_INTAKE_WORKER_ENABLED;
  process.env.Y2T_API_KEY = "operator-api-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.Y2T_INTAKE_WORKER_ENABLED = "false";
  const config = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir: join(dir, "output"),
    audioDir: join(dir, "audio"),
  });
  const fakePipeline = async (
    input: any,
    _config: any,
    options: { emitter?: PipelineEventEmitter }
  ) => {
    const timestamp = new Date().toISOString();
    options.emitter?.emit({
      type: "run:start",
      inputUrl: `audio:${input.audioId}`,
      channelId: "uploads",
      channelTitle: "Uploads",
      channelDirName: "uploads",
      totalVideos: 1,
      alreadyProcessed: 0,
      remaining: 1,
      timestamp,
    });
    options.emitter?.emit({
      type: "video:done",
      videoId: input.audioId,
      basename: "legacy-audio",
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
      channelId: "uploads",
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      timestamp,
    });
  };
  const { server } = await startApiServer(config, {
    host: "127.0.0.1",
    port: 0,
    maxBufferedEventsPerRun: 10,
    persistRuns: false,
    deps: { runPipeline: fakePipeline as typeof import("../src/pipeline/run.js").runPipeline },
  });
  if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const headers = { "x-api-key": process.env.Y2T_API_KEY };
  try {
    const form = new FormData();
    form.append("file", new File([Buffer.from("audio-bytes")], "recording.mp3", { type: "audio/mpeg" }));
    const uploaded = await fetch(`http://127.0.0.1:${port}/audio`, {
      method: "POST",
      headers,
      body: form,
    });
    assert.equal(uploaded.status, 201);
    const uploadBody = await uploaded.json() as any;
    assert.equal(uploadBody.intake.status, "held");
    assert.match(uploadBody.intake.intakeId, /^int_[a-f0-9]{64}$/);

    const started = await fetch(`http://127.0.0.1:${port}/runs`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ audioId: uploadBody.audio.audioId }),
    });
    assert.equal(started.status, 201);

    await waitUntil(async () => {
      const response = await fetch(
        `http://127.0.0.1:${port}/v1/intakes/${uploadBody.intake.intakeId}`,
        { headers }
      );
      const body = await response.json() as any;
      return body.intake.status === "completed";
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
    if (previousApiKey === undefined) delete process.env.Y2T_API_KEY;
    else process.env.Y2T_API_KEY = previousApiKey;
    if (previousWorker === undefined) delete process.env.Y2T_INTAKE_WORKER_ENABLED;
    else process.env.Y2T_INTAKE_WORKER_ENABLED = previousWorker;
  }
});

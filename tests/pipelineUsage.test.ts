import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RunManager } from "../src/api/runManager.js";
import { configSchema } from "../src/config/schema.js";
import type { PipelineEvent } from "../src/pipeline/events.js";
import { runPipeline } from "../src/pipeline/run.js";
import type { TranscriptionProvider } from "../src/transcription/index.js";
import { UsageLedger, type UsagePolicy } from "../src/usage/index.js";

function usagePolicy(maxItemMinutes: number): UsagePolicy {
  return {
    enforcement: "enforce",
    maxItemMinutes,
    maxRunMinutes: 0,
    maxSourceMinutes24h: 0,
    maxTotalMinutes30d: 0,
    maxTotalUsd30d: 0,
    ratesUsdPerHour: {
      assemblyai: 1,
      deepgram: 1,
      openai_whisper: 1,
    },
  };
}

async function runAudioCase(maxItemMinutes: number) {
  const dir = await mkdtemp(join(tmpdir(), "y2t-pipeline-usage-"));
  const source = join(dir, "source.mp3");
  await writeFile(source, "fake-audio", "utf8");
  const config = configSchema.parse({
    sttProvider: "deepgram",
    deepgramApiKey: "test",
    outputDir: join(dir, "output"),
    audioDir: join(dir, "audio"),
    commentsEnabled: false,
    assemblyAiCreditsCheck: "none",
  });
  const ledger = new UsageLedger(config.outputDir, {
    policy: usagePolicy(maxItemMinutes),
  });
  const events: PipelineEvent[] = [];
  let providerCalls = 0;
  const provider: TranscriptionProvider = {
    name: "deepgram",
    getCapabilities: () => ({ supportsDiarization: true }),
    transcribe: async () => {
      providerCalls += 1;
      return { id: "transcript-1", status: "completed", text: "hello" };
    },
  };

  const pipeline = runPipeline(
      {
        kind: "audio",
        audioId: "audio-1",
        audioPath: source,
        title: "Usage test",
      },
      config,
      {
        force: false,
        runId: "run-usage-test",
        emitter: { emit: (event) => events.push(event) },
        deps: {
          createTranscriptionProvider: () => provider,
          getAudioDurationSeconds: async () => 120,
          usageLedger: ledger,
        },
      }
  );
  return {
    pipeline,
    providerCalls: () => providerCalls,
    events,
    ledger,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test("pipeline blocks at the provider boundary when an item exceeds its cap", async () => {
  const result = await runAudioCase(1);
  try {
    await assert.rejects(result.pipeline, /Usage limit exceeded/);
    assert.equal(result.providerCalls(), 0);
    assert.equal((await result.ledger.snapshot()).last30d.reservations, 0);
    assert.equal(result.events.filter((event) => event.type === "run:error").length, 1);
    assert.ok(!result.events.some((event) => event.type === "run:done"));
  } finally {
    await result.cleanup();
  }
});

test("pipeline completes and records usage when the provider call is allowed", async () => {
  const result = await runAudioCase(3);
  try {
    await result.pipeline;
    const snapshot = await result.ledger.snapshot();
    assert.equal(result.providerCalls(), 1);
    assert.equal(snapshot.last30d.audioMinutes, 2);
    assert.equal(snapshot.pendingReservations, 0);
    assert.ok(result.events.some((event) => event.type === "run:done"));
  } finally {
    await result.cleanup();
  }
});

test("RunManager preserves a provider-boundary usage rejection as terminal error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "y2t-manager-usage-"));
  const source = join(dir, "source.mp3");
  await writeFile(source, "fake-audio", "utf8");
  const config = configSchema.parse({
    sttProvider: "deepgram",
    deepgramApiKey: "test",
    outputDir: join(dir, "output"),
    audioDir: join(dir, "audio"),
    commentsEnabled: false,
  });
  const ledger = new UsageLedger(config.outputDir, { policy: usagePolicy(1) });
  let providerCalls = 0;
  const provider: TranscriptionProvider = {
    name: "deepgram",
    getCapabilities: () => ({ supportsDiarization: true }),
    transcribe: async () => {
      providerCalls += 1;
      return { id: "unexpected", status: "completed", text: "unexpected" };
    },
  };
  const manager = new RunManager(config, {
    maxBufferedEventsPerRun: 20,
    persistRuns: false,
    deps: {
      runPipeline: (input, effectiveConfig, options) => runPipeline(
        input,
        effectiveConfig,
        {
          ...options,
          deps: {
            createTranscriptionProvider: () => provider,
            getAudioDurationSeconds: async () => 120,
            usageLedger: ledger,
          },
        }
      ),
    },
  });

  try {
    const request = {
      audioId: "audio-manager-1",
      audioPath: source,
      audioTitle: "Usage manager test",
    };
    const record = manager.createRun(request);
    manager.startRun(record.runId, request);
    assert.equal(await manager.waitForIdle(5_000), true);
    assert.equal(manager.getRun(record.runId)?.status, "error");
    assert.match(manager.getRun(record.runId)?.error ?? "", /Usage limit exceeded/);
    assert.equal(providerCalls, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

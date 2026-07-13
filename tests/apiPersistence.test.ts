import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../src/config/schema.js";
import { RunManager } from "../src/api/runManager.js";

test("RunManager persists runs and events and reloads on init()", async () => {
  const dir = mkdtempSync(join(tmpdir(), "y2t-api-"));
  const baseConfig = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir: dir,
    audioDir: join(dir, "audio"),
  });

  const m1 = new RunManager(baseConfig, {
    maxBufferedEventsPerRun: 50,
    persistRuns: true,
    persistDir: join(dir, "_runs"),
  });
  await m1.init();

  const run = m1.createRun({ url: "https://example.com" });
  run.status = "done";
  run.finishedAt = "t2";
  (m1 as any).persistRun(run);
  (m1 as any).onEvent(run.runId, {
    type: "run:start",
    inputUrl: run.inputUrl,
    channelId: "UC123",
    channelTitle: "Chan",
    totalVideos: 1,
    alreadyProcessed: 0,
    remaining: 1,
    timestamp: "t",
  });
  (m1 as any).onEvent(run.runId, {
    type: "run:done",
    channelId: "UC123",
    total: 1,
    succeeded: 1,
    failed: 0,
    skipped: 0,
    timestamp: "t2",
  });
  await m1.flush();

  const m2 = new RunManager(baseConfig, {
    maxBufferedEventsPerRun: 50,
    persistRuns: true,
    persistDir: join(dir, "_runs"),
  });
  await m2.init();

  const loaded = m2.getRun(run.runId);
  assert.ok(loaded);
  assert.equal(loaded.channelId, "UC123");
  assert.equal(loaded.status, "done");
  const events = m2.listEventsAfter(run.runId, 0);
  assert.equal(events.length, 2);
  assert.equal(events[0].event.type, "run:start");
  assert.equal(events[1].event.type, "run:done");
});

test("RunManager marks persisted active runs as interrupted on init()", async () => {
  const dir = mkdtempSync(join(tmpdir(), "y2t-api-interrupted-"));
  const baseConfig = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir: dir,
    audioDir: join(dir, "audio"),
  });

  const m1 = new RunManager(baseConfig, {
    maxBufferedEventsPerRun: 50,
    persistRuns: true,
    persistDir: join(dir, "_runs"),
  });
  await m1.init();

  const queued = m1.createRun({ url: "https://example.com/queued" });
  const running = m1.createRun({ url: "https://example.com/running" });
  running.status = "running";
  running.startedAt = "t1";
  (m1 as any).persistRun(running);
  await m1.flush();

  const m2 = new RunManager(baseConfig, {
    maxBufferedEventsPerRun: 50,
    persistRuns: true,
    persistDir: join(dir, "_runs"),
  });
  await m2.init();

  const loadedQueued = m2.getRun(queued.runId);
  const loadedRunning = m2.getRun(running.runId);

  assert.equal(loadedQueued?.status, "error");
  assert.match(String(loadedQueued?.error ?? ""), /interrupted.*queued/);
  assert.equal(typeof loadedQueued?.finishedAt, "string");

  assert.equal(loadedRunning?.status, "error");
  assert.match(String(loadedRunning?.error ?? ""), /interrupted.*running/);
  assert.equal(loadedRunning?.startedAt, "t1");
  assert.equal(typeof loadedRunning?.finishedAt, "string");
});

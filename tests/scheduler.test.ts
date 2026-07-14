import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../src/config/schema.js";
import { RunManager } from "../src/api/runManager.js";
import { WatchlistStore } from "../src/api/watchlist.js";
import { Scheduler } from "../src/api/scheduler.js";
import type { RunPlan } from "../src/pipeline/plan.js";

test("Scheduler trigger creates runs only when plan.toProcess > 0 and respects maxConcurrentRuns", async () => {
  const dir = mkdtempSync(join(tmpdir(), "y2t-scheduler-"));
  const config = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir: dir,
    audioDir: join(dir, "audio"),
  });

  const manager = new RunManager(config, { maxBufferedEventsPerRun: 10, persistRuns: false });
  await manager.init();

  const store = new WatchlistStore(dir);
  const e1 = await store.add({ channelUrl: "https://www.youtube.com/@a" });
  const e2 = await store.add({ channelUrl: "https://www.youtube.com/@b" });

  const planFn = async (url: string): Promise<RunPlan> => ({
    inputUrl: url,
    force: false,
    channelId: "UC123",
    channelTitle: "Chan",
    totalVideos: 1,
    alreadyProcessed: 0,
    toProcess: 1,
    filters: {},
    videos: [{ id: "v", title: "t", url: "u", basename: "b", processed: false }],
  });

  const scheduler = new Scheduler(
    { enabled: false, intervalMinutes: 60, maxConcurrentRuns: 1 },
    manager,
    store,
    planFn,
    (req) => manager.createRun(req),
    () => {
      // no-op: do not start pipeline in unit tests
    }
  );

  const res = await scheduler.triggerOnce();
  assert.equal(res.runsCreated, 1);
  assert.equal(res.checked, 1);

  const after = await store.list();
  const a = after.find((x) => x.id === e1.id)!;
  const b = after.find((x) => x.id === e2.id)!;
  assert.ok(a.lastCheckedAt);
  assert.equal(b.lastCheckedAt, undefined);
  assert.ok(a.lastRunId);
  assert.equal(b.lastRunId, undefined);

  const runs = manager.listRuns();
  assert.equal(runs.length, 1);
  runs[0]!.status = "done";

  const second = await scheduler.triggerOnce();
  assert.equal(second.runsCreated, 1);
  assert.equal(second.checked, 1);

  const finalEntries = await store.list();
  const finalB = finalEntries.find((x) => x.id === e2.id)!;
  assert.ok(finalB.lastCheckedAt);
  assert.ok(finalB.lastRunId);
  assert.equal(manager.listRuns().length, 2);
});

test("Scheduler trigger does not create run when plan.toProcess == 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "y2t-scheduler-0-"));
  const config = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir: dir,
    audioDir: join(dir, "audio"),
  });

  const manager = new RunManager(config, { maxBufferedEventsPerRun: 10, persistRuns: false });
  await manager.init();

  const store = new WatchlistStore(dir);
  await store.add({ channelUrl: "https://www.youtube.com/@a" });

  const planFn = async (url: string): Promise<RunPlan> => ({
    inputUrl: url,
    force: false,
    channelId: "UC123",
    channelTitle: "Chan",
    totalVideos: 1,
    alreadyProcessed: 1,
    toProcess: 0,
    filters: {},
    videos: [{ id: "v", title: "t", url: "u", basename: "b", processed: true }],
  });

  const scheduler = new Scheduler(
    { enabled: false, intervalMinutes: 60, maxConcurrentRuns: 1 },
    manager,
    store,
    planFn,
    (req) => manager.createRun(req),
    () => {}
  );

  const res = await scheduler.triggerOnce();
  assert.equal(res.runsCreated, 0);
  assert.equal(manager.listRuns().length, 0);
});

test("Scheduler skips non-channel/playlist watchlist URLs by default", async () => {
  const prev = process.env.Y2T_WATCHLIST_ALLOW_ANY_URL;
  delete process.env.Y2T_WATCHLIST_ALLOW_ANY_URL;
  try {
    const dir = mkdtempSync(join(tmpdir(), "y2t-scheduler-validate-"));
    const config = configSchema.parse({
      assemblyAiApiKey: "test",
      outputDir: dir,
      audioDir: join(dir, "audio"),
    });

    const manager = new RunManager(config, { maxBufferedEventsPerRun: 10, persistRuns: false });
    await manager.init();

    const store = new WatchlistStore(dir);
    const entry = await store.add({ channelUrl: "https://www.youtube.com/watch?v=abc" });

    let planned = 0;
    const planFn = async (_url: string): Promise<RunPlan> => {
      planned += 1;
      return {
        inputUrl: _url,
        force: false,
        channelId: "UC123",
        channelTitle: "Chan",
        totalVideos: 1,
        alreadyProcessed: 0,
        toProcess: 1,
        filters: {},
        videos: [{ id: "v", title: "t", url: "u", basename: "b", processed: false }],
      };
    };

    const scheduler = new Scheduler(
      { enabled: false, intervalMinutes: 60, maxConcurrentRuns: 1 },
      manager,
      store,
      planFn,
      (req) => manager.createRun(req),
      () => {}
    );

    const res = await scheduler.triggerOnce();
    assert.equal(res.checked, 1);
    assert.equal(res.runsCreated, 0);
    assert.equal(planned, 0);
    assert.equal(manager.listRuns().length, 0);

    const after = await store.get(entry.id);
    assert.ok(after?.lastCheckedAt);
  } finally {
    if (prev === undefined) delete process.env.Y2T_WATCHLIST_ALLOW_ANY_URL;
    else process.env.Y2T_WATCHLIST_ALLOW_ANY_URL = prev;
  }
});

test("Scheduler ignores concurrent triggerOnce calls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "y2t-scheduler-concurrent-"));
  const config = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir: dir,
    audioDir: join(dir, "audio"),
  });

  const manager = new RunManager(config, { maxBufferedEventsPerRun: 10, persistRuns: false });
  await manager.init();

  const store = new WatchlistStore(dir);
  await store.add({ channelUrl: "https://www.youtube.com/@a" });

  let releasePlan: (() => void) | undefined;
  const planGate = new Promise<void>((resolve) => {
    releasePlan = resolve;
  });
  let planStarted = 0;

  const planFn = async (url: string): Promise<RunPlan> => {
    planStarted += 1;
    if (planStarted === 1) await planGate;
    return {
      inputUrl: url,
      force: false,
      channelId: "UC123",
      channelTitle: "Chan",
      totalVideos: 1,
      alreadyProcessed: 0,
      toProcess: 1,
      filters: {},
      videos: [{ id: "v", title: "t", url: "u", basename: "b", processed: false }],
    };
  };

  const scheduler = new Scheduler(
    { enabled: false, intervalMinutes: 60, maxConcurrentRuns: 1 },
    manager,
    store,
    planFn,
    (req) => manager.createRun(req),
    () => {}
  );

  const first = scheduler.triggerOnce();

  for (let i = 0; i < 50; i += 1) {
    if (planStarted > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const second = await scheduler.triggerOnce();
  assert.equal(second.checked, 0);
  assert.equal(second.runsCreated, 0);

  releasePlan?.();
  const firstResult = await first;
  assert.equal(firstResult.runsCreated, 1);
});

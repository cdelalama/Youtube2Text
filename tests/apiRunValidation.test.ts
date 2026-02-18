import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../src/config/schema.js";
import { startApiServer } from "../src/api/server.js";

async function listenServer(server: any): Promise<void> {
  if (server.listening) return;
  await new Promise<void>((resolve) => server.once("listening", resolve));
}

test("POST /runs/plan clamps maxNewVideos and validates afterDate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "y2t-run-validate-"));
  const config = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir: dir,
    audioDir: join(dir, "audio"),
  });

  const { server } = await startApiServer(config, {
    host: "127.0.0.1",
    port: 0,
    maxBufferedEventsPerRun: 10,
    persistRuns: false,
    deps: {
      planRun: async (_url: string, cfg: any) => ({
        inputUrl: _url,
        force: false,
        channelId: "C1",
        channelTitle: "Chan",
        totalVideos: 0,
        alreadyProcessed: 0,
        toProcess: 0,
        filters: {},
        videos: [],
        maxNewVideosSeen: cfg.maxNewVideos ?? null,
        afterDateSeen: cfg.afterDate ?? null,
      }),
    },
  });
  await listenServer(server);
  const port = (server.address() as any).port as number;

  try {
    const bad = await fetch(`http://127.0.0.1:${port}/runs/plan`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "test-api-key-aaaaaaaaaaaaaaaaaaaaaa" },
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=abc", afterDate: "2024-99-99" }),
    });
    assert.equal(bad.status, 400);

    const ok = await fetch(`http://127.0.0.1:${port}/runs/plan`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "test-api-key-aaaaaaaaaaaaaaaaaaaaaa" },
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=abc", maxNewVideos: 99999, afterDate: "2024-01-01" }),
    });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as any;
    assert.equal(body.plan.maxNewVideosSeen, 5000);
    assert.equal(body.plan.afterDateSeen, "2024-01-01");

    // beforeDate < afterDate returns 400
    const badRange = await fetch(`http://127.0.0.1:${port}/runs/plan`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "test-api-key-aaaaaaaaaaaaaaaaaaaaaa" },
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=abc", afterDate: "2024-06-01", beforeDate: "2024-01-01" }),
    });
    assert.equal(badRange.status, 400, "beforeDate < afterDate should return 400");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("POST /runs/plan treats null optional inputs as unset", async () => {
  const dir = mkdtempSync(join(tmpdir(), "y2t-run-null-"));
  const config = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir: dir,
    audioDir: join(dir, "audio"),
  });

  const { server } = await startApiServer(config, {
    host: "127.0.0.1",
    port: 0,
    maxBufferedEventsPerRun: 10,
    persistRuns: false,
    deps: {
      planRun: async (_url: string, cfg: any) => ({
        inputUrl: _url,
        force: false,
        channelId: "C1",
        channelTitle: "Chan",
        totalVideos: 0,
        alreadyProcessed: 0,
        toProcess: 0,
        filters: {},
        videos: [],
        maxNewVideosSeen: cfg.maxNewVideos ?? null,
        afterDateSeen: cfg.afterDate ?? null,
      }),
    },
  });
  await listenServer(server);
  const port = (server.address() as any).port as number;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/runs/plan`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "test-api-key-aaaaaaaaaaaaaaaaaaaaaa" },
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=abc", maxNewVideos: null, afterDate: null }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.plan.maxNewVideosSeen, null);
    assert.equal(body.plan.afterDateSeen, null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

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

test("GET /health returns basic response (no auth required)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "y2t-health-"));
  const config = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir: dir,
    audioDir: join(dir, "audio"),
  });

  const { server } = await startApiServer(config, {
    host: "127.0.0.1",
    port: 0,
    maxBufferedEventsPerRun: 10,
    persistRuns: true,
    persistDir: join(dir, "_runs"),
  });
  await listenServer(server);
  const port = (server.address() as any).port as number;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, "youtube2text-api");
    assert.equal(typeof body.version, "string");
    assert.ok(body.version.length > 0, "version should not be empty");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("GET /health?deep=true returns deep health structure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "y2t-health-deep-"));
  const config = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir: dir,
    audioDir: join(dir, "audio"),
    ytDlpPath: "definitely-not-a-real-yt-dlp",
  });

  const { server } = await startApiServer(config, {
    host: "127.0.0.1",
    port: 0,
    maxBufferedEventsPerRun: 10,
    persistRuns: true,
    persistDir: join(dir, "_runs"),
  });
  await listenServer(server);
  const port = (server.address() as any).port as number;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/health?deep=true`, {
      headers: { "x-api-key": "test-api-key-aaaaaaaaaaaaaaaaaaaaaa" },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.service, "youtube2text-api");
    assert.ok(body.deps);
    assert.ok(body.deps.ytDlp);
    assert.ok(body.deps.ffmpeg);
    assert.ok(body.deps.disk);
    assert.ok(body.deps.persist);
    assert.equal(body.deps.persist.dir, "redacted");
    assert.equal(typeof body.deps.persist.writable, "boolean");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

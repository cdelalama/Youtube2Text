import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../src/config/schema.js";
import { startApiServer } from "../src/api/server.js";

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function listenReady(server: any): Promise<void> {
  if (server.listening) return Promise.resolve();
  return new Promise<void>((resolve) => server.once("listening", resolve));
}

function writeCatalogFile(outputDir: string, channelId: string, catalog: object): void {
  const dir = join(outputDir, "_catalog");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${channelId}.json`), JSON.stringify(catalog));
}

test("GET /catalog returns empty list when no catalogs exist", async () => {
  const dir = makeTempDir("y2t-catalog-empty-");
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
  });
  await listenReady(server);
  const port = (server.address() as any).port as number;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/catalog`, {
      headers: { "x-api-key": "test-api-key-aaaaaaaaaaaaaaaaaaaaaa" },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.ok(Array.isArray(body.catalogs));
    assert.equal(body.catalogs.length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("GET /catalog lists cached catalog summaries", async () => {
  const dir = makeTempDir("y2t-catalog-list-");
  writeCatalogFile(dir, "UC_abc123", {
    version: 1,
    channelId: "UC_abc123",
    channelTitle: "Test Channel",
    inputUrl: "https://www.youtube.com/@test",
    retrievedAt: "2026-01-01T00:00:00.000Z",
    complete: true,
    videos: [
      { id: "v1", title: "Video 1", url: "https://youtube.com/watch?v=v1" },
      { id: "v2", title: "Video 2", url: "https://youtube.com/watch?v=v2" },
    ],
  });

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
  });
  await listenReady(server);
  const port = (server.address() as any).port as number;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/catalog`, {
      headers: { "x-api-key": "test-api-key-aaaaaaaaaaaaaaaaaaaaaa" },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.catalogs.length, 1);
    assert.equal(body.catalogs[0].channelId, "UC_abc123");
    assert.equal(body.catalogs[0].channelTitle, "Test Channel");
    assert.equal(body.catalogs[0].videoCount, 2);
    assert.ok(!body.catalogs[0].videos, "summary should not include full video list");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("GET /catalog/:channelId returns full catalog", async () => {
  const dir = makeTempDir("y2t-catalog-detail-");
  const videos = [
    { id: "v1", title: "Video 1", url: "https://youtube.com/watch?v=v1" },
    { id: "v2", title: "Video 2", url: "https://youtube.com/watch?v=v2" },
  ];
  writeCatalogFile(dir, "UC_detail", {
    version: 1,
    channelId: "UC_detail",
    channelTitle: "Detail Channel",
    inputUrl: "https://www.youtube.com/@detail",
    retrievedAt: "2026-01-01T00:00:00.000Z",
    complete: true,
    videos,
  });

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
  });
  await listenReady(server);
  const port = (server.address() as any).port as number;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/catalog/UC_detail`, {
      headers: { "x-api-key": "test-api-key-aaaaaaaaaaaaaaaaaaaaaa" },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.catalog.channelId, "UC_detail");
    assert.equal(body.catalog.channelTitle, "Detail Channel");
    assert.equal(body.catalog.videos.length, 2);
    assert.equal(body.catalog.videos[0].id, "v1");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("GET /catalog/:channelId returns 404 for missing channel", async () => {
  const dir = makeTempDir("y2t-catalog-404-");
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
  });
  await listenReady(server);
  const port = (server.address() as any).port as number;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/catalog/UC_nonexistent`, {
      headers: { "x-api-key": "test-api-key-aaaaaaaaaaaaaaaaaaaaaa" },
    });
    assert.equal(res.status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("GET /catalog requires auth", async () => {
  const dir = makeTempDir("y2t-catalog-auth-");
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
  });
  await listenReady(server);
  const port = (server.address() as any).port as number;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/catalog`);
    assert.equal(res.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../src/config/schema.js";
import { startApiServer } from "../src/api/server.js";

const API_KEY = "test-api-key-aaaaaaaaaaaaaaaaaaaaaa";
const headers = { "x-api-key": API_KEY };

async function listenServer(server: any): Promise<void> {
  if (server.listening) return;
  await new Promise<void>((resolve) => server.once("listening", resolve));
}

function setupChannelDir(base: string, channelDir: string) {
  const outputDir = join(base, "output");
  const audioDir = join(base, "audio");
  const channelOutput = join(outputDir, channelDir);
  const channelAudio = join(audioDir, channelDir);
  mkdirSync(channelOutput, { recursive: true });
  mkdirSync(channelAudio, { recursive: true });

  // Create video files
  const basename = "My-Video___abc123";
  writeFileSync(join(channelOutput, `${basename}.json`), "{}");
  writeFileSync(join(channelOutput, `${basename}.txt`), "text");
  writeFileSync(join(channelOutput, `${basename}.md`), "# md");
  writeFileSync(join(channelOutput, `${basename}.jsonl`), "{}");
  writeFileSync(join(channelOutput, `${basename}.csv`), "a,b");
  writeFileSync(join(channelOutput, `${basename}.meta.json`), JSON.stringify({ videoId: "abc123" }));
  writeFileSync(join(channelOutput, `${basename}.comments.json`), "[]");
  writeFileSync(join(channelOutput, "_channel.json"), JSON.stringify({ channelId: "UC_TEST1" }));
  writeFileSync(join(channelAudio, `${basename}.mp3`), "audio");

  return { outputDir, audioDir, basename };
}

async function startTestServer(outputDir: string, audioDir: string) {
  const config = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir,
    audioDir,
  });
  const { server } = await startApiServer(config, {
    host: "127.0.0.1",
    port: 0,
    maxBufferedEventsPerRun: 10,
    persistRuns: false,
  });
  await listenServer(server);
  const port = (server.address() as any).port as number;
  return { server, port };
}

test("DELETE /library/channels/:dir removes output and audio dirs", async () => {
  const base = mkdtempSync(join(tmpdir(), "y2t-del-chan-"));
  const channelDir = "TestChannel__UC_TEST1";
  const { outputDir, audioDir } = setupChannelDir(base, channelDir);
  const { server, port } = await startTestServer(outputDir, audioDir);

  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/library/channels/${encodeURIComponent(channelDir)}`,
      { method: "DELETE", headers }
    );
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.ok, true);
    assert.ok(body.deleted.outputFiles > 0);
    assert.equal(existsSync(join(outputDir, channelDir)), false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("DELETE /library/channels/:dir removes catalog cache", async () => {
  const base = mkdtempSync(join(tmpdir(), "y2t-del-catalog-"));
  const channelDir = "TestChannel__UC_TEST1";
  const { outputDir, audioDir } = setupChannelDir(base, channelDir);

  // Create catalog cache
  const catalogDir = join(outputDir, "_catalog");
  mkdirSync(catalogDir, { recursive: true });
  writeFileSync(join(catalogDir, "UC_TEST1.json"), "{}");

  const { server, port } = await startTestServer(outputDir, audioDir);

  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/library/channels/${encodeURIComponent(channelDir)}`,
      { method: "DELETE", headers }
    );
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.deleted.catalogCacheRemoved, true);
    assert.equal(existsSync(join(catalogDir, "UC_TEST1.json")), false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("DELETE /library/channels/:dir returns 404 for non-existent channel", async () => {
  const base = mkdtempSync(join(tmpdir(), "y2t-del-404-"));
  const outputDir = join(base, "output");
  const audioDir = join(base, "audio");
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(audioDir, { recursive: true });
  const { server, port } = await startTestServer(outputDir, audioDir);

  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/library/channels/NoSuchChannel__UC_NONE`,
      { method: "DELETE", headers }
    );
    assert.equal(res.status, 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("DELETE /library/channels/:dir returns 400 for path traversal", async () => {
  const base = mkdtempSync(join(tmpdir(), "y2t-del-traversal-"));
  const outputDir = join(base, "output");
  const audioDir = join(base, "audio");
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(audioDir, { recursive: true });
  const { server, port } = await startTestServer(outputDir, audioDir);

  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/library/channels/${encodeURIComponent("../../../etc")}`,
      { method: "DELETE", headers }
    );
    assert.equal(res.status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("DELETE /library/channels/:dir/videos/:basename removes all video files", async () => {
  const base = mkdtempSync(join(tmpdir(), "y2t-del-vid-"));
  const channelDir = "TestChannel__UC_TEST1";
  const { outputDir, audioDir, basename } = setupChannelDir(base, channelDir);
  const { server, port } = await startTestServer(outputDir, audioDir);

  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/library/channels/${encodeURIComponent(channelDir)}/videos/${encodeURIComponent(basename)}`,
      { method: "DELETE", headers }
    );
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.deleted.outputFiles, 7);
    assert.equal(body.deleted.audioFiles, 1);

    // Verify files are gone
    assert.equal(existsSync(join(outputDir, channelDir, `${basename}.json`)), false);
    assert.equal(existsSync(join(audioDir, channelDir, `${basename}.mp3`)), false);

    // Channel dir should still exist (with _channel.json)
    assert.equal(existsSync(join(outputDir, channelDir)), true);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("DELETE /library/channels/:dir/videos/:basename returns 404 for non-existent video", async () => {
  const base = mkdtempSync(join(tmpdir(), "y2t-del-vid-404-"));
  const channelDir = "TestChannel__UC_TEST1";
  const { outputDir, audioDir } = setupChannelDir(base, channelDir);
  const { server, port } = await startTestServer(outputDir, audioDir);

  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/library/channels/${encodeURIComponent(channelDir)}/videos/NonExistentVideo`,
      { method: "DELETE", headers }
    );
    assert.equal(res.status, 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("DELETE /library/channels/:dir/videos/:basename returns 400 for path traversal", async () => {
  const base = mkdtempSync(join(tmpdir(), "y2t-del-vid-trav-"));
  const channelDir = "TestChannel__UC_TEST1";
  const { outputDir, audioDir } = setupChannelDir(base, channelDir);
  const { server, port } = await startTestServer(outputDir, audioDir);

  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/library/channels/${encodeURIComponent(channelDir)}/videos/${encodeURIComponent("../../etc/passwd")}`,
      { method: "DELETE", headers }
    );
    assert.equal(res.status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("DELETE library endpoints require auth (401 without API key)", async () => {
  const base = mkdtempSync(join(tmpdir(), "y2t-del-auth-"));
  const channelDir = "TestChannel__UC_TEST1";
  const { outputDir, audioDir } = setupChannelDir(base, channelDir);
  const { server, port } = await startTestServer(outputDir, audioDir);

  try {
    const res1 = await fetch(
      `http://127.0.0.1:${port}/library/channels/${encodeURIComponent(channelDir)}`,
      { method: "DELETE" }
    );
    assert.equal(res1.status, 401);

    const res2 = await fetch(
      `http://127.0.0.1:${port}/library/channels/${encodeURIComponent(channelDir)}/videos/SomeVideo`,
      { method: "DELETE" }
    );
    assert.equal(res2.status, 401);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

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

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "y2t-providers-"));
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
  await listenServer(server);
  const port = (server.address() as any).port as number;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("GET /providers returns provider capabilities", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/providers`, { headers: { "x-api-key": "test-api-key-aaaaaaaaaaaaaaaaaaaaaa" } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.ok(Array.isArray(body.providers));
    const ids = body.providers.map((p: any) => p.id);
    assert.ok(ids.includes("assemblyai"));
    assert.ok(ids.includes("deepgram"));
    assert.ok(ids.includes("openai_whisper"));
  });
});

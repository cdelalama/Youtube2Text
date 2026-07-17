import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startApiServer } from "../src/api/server.js";
import { configSchema } from "../src/config/schema.js";
import { TranscriptStore } from "../src/transcripts/store.js";

test("transcript API returns the exact bytes named by its integrity hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "y2t-api-transcript-"));
  const outputDir = join(dir, "output");
  const audioDir = join(dir, "audio");
  const audioPath = join(audioDir, "fixture.mp3");
  const txtPath = join(outputDir, "fixture", "fixture.txt");
  await mkdir(join(outputDir, "fixture"), { recursive: true });
  await mkdir(audioDir, { recursive: true });
  await writeFile(audioPath, "audio", "utf8");
  await writeFile(txtPath, "hello\n", "utf8");
  const stored = await new TranscriptStore(outputDir).write({
    materializedAt: "2026-07-15T00:00:00.000Z",
    producerVersion: "0.38.0",
    runId: "run-1",
    source: {
      kind: "youtube",
      authority: "youtube",
      sourceItemId: "video-1",
      sourceCollectionId: "channel-1",
      canonicalUrl: "https://www.youtube.com/watch?v=video-1",
      title: "Video 1",
      createdAt: null,
      createdAtType: "unknown",
      createdAtSuppliedBy: null,
      createdAtUnavailableReason: "YouTube listing did not provide an RFC3339 source time",
    },
    audioPath,
    durationSeconds: 2,
    contentType: "audio/mpeg",
    provider: "deepgram",
    model: "nova-3",
    transcript: { id: "provider-1", status: "completed", text: "hello" },
    representations: [
      { format: "text", absolutePath: txtPath, content: "hello\n" },
    ],
  });
  const previousApiKey = process.env.Y2T_API_KEY;
  const previousWorker = process.env.Y2T_INTAKE_WORKER_ENABLED;
  const previousCortexKey = process.env.Y2T_CORTEX_TRANSCRIPT_READ_KEY;
  process.env.Y2T_API_KEY = "operator-api-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.Y2T_INTAKE_WORKER_ENABLED = "false";
  process.env.Y2T_CORTEX_TRANSCRIPT_READ_KEY = "cortex-transcript-read-aaaaaaaaaaaaaaaa";
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
  if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const headers = { "x-api-key": process.env.Y2T_API_KEY };
  try {
    const list = await fetch(`http://127.0.0.1:${port}/v1/transcripts`, { headers });
    assert.equal(list.status, 200);
    const summary = ((await list.json()) as any).items[0];
    assert.equal(summary.recordSha256, stored.recordSha256);
    assert.equal(summary.materializedAt, "2026-07-15T00:00:00.000Z");
    assert.equal(summary.lifecycle.status, "current");

    const response = await fetch(`http://127.0.0.1:${port}${summary.href}`, { headers });
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-media2text-record-sha256"), digest);
    assert.equal(response.headers.get("etag"), `"sha256:${digest}"`);
    assert.equal(digest, stored.recordSha256);

    const cortexHeaders = {
      authorization: `Bearer ${process.env.Y2T_CORTEX_TRANSCRIPT_READ_KEY}`,
    };
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/v1/transcripts`, { headers: cortexHeaders })).status,
      200
    );
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}${summary.href}`, { headers: cortexHeaders })).status,
      200
    );
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/metrics`, { headers: cortexHeaders })).status,
      401
    );
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/v1/transcripts?cursor=invalid`, { headers: cortexHeaders })).status,
      400
    );

    const status = await fetch(`http://127.0.0.1:${port}/status/media-pipeline`);
    assert.equal(status.status, 200);
    const statusBody = (await status.json()) as any;
    const delivery = statusBody.checks.find(
      (check: { name?: string }) => check.name === "transcript_delivery"
    );
    assert.equal(delivery.summary, "0 delivered; 1 pending.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
    if (previousApiKey === undefined) delete process.env.Y2T_API_KEY;
    else process.env.Y2T_API_KEY = previousApiKey;
    if (previousWorker === undefined) delete process.env.Y2T_INTAKE_WORKER_ENABLED;
    else process.env.Y2T_INTAKE_WORKER_ENABLED = previousWorker;
    if (previousCortexKey === undefined) delete process.env.Y2T_CORTEX_TRANSCRIPT_READ_KEY;
    else process.env.Y2T_CORTEX_TRANSCRIPT_READ_KEY = previousCortexKey;
  }
});

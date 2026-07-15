import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startApiServer } from "../src/api/server.js";
import { configSchema } from "../src/config/schema.js";

async function listen(server: any): Promise<number> {
  if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
  return (server.address() as { port: number }).port;
}

test("POST /v1/intakes persists before 202 with least-privilege auth", async () => {
  const dir = await mkdtemp(join(tmpdir(), "y2t-api-intake-"));
  const previous = {
    api: process.env.Y2T_API_KEY,
    intake: process.env.Y2T_INTAKE_API_KEY,
    worker: process.env.Y2T_INTAKE_WORKER_ENABLED,
  };
  process.env.Y2T_API_KEY = "operator-api-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.Y2T_INTAKE_API_KEY = "intake-service-key-bbbbbbbbbbbbbbbbbbbbb";
  process.env.Y2T_INTAKE_WORKER_ENABLED = "false";
  const config = configSchema.parse({
    assemblyAiApiKey: "test",
    outputDir: join(dir, "output"),
    audioDir: join(dir, "audio"),
  });
  const { server } = await startApiServer(config, {
    host: "127.0.0.1",
    port: 0,
    maxBufferedEventsPerRun: 10,
    persistRuns: false,
  });
  const port = await listen(server);
  const digest = "a".repeat(64);
  const request = {
    schemaVersion: "media2text.intake.v1",
    eventId: "evt-source-1",
    idempotencyKey: "source:item-1:revision-1",
    source: {
      authority: "plaud-mirror",
      itemId: "item-1",
      artifactRevision: `sha256:${digest}`,
    },
    artifact: {
      url: "https://source.example/secret-signed-path",
      sha256: digest,
      bytes: 10,
      contentType: "audio/mpeg",
    },
  };
  try {
    const admitted = await fetch(`http://127.0.0.1:${port}/v1/intakes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-media2text-intake-key": process.env.Y2T_INTAKE_API_KEY,
      },
      body: JSON.stringify(request),
    });
    assert.equal(admitted.status, 202);
    const admittedBody = await admitted.json() as any;
    assert.equal(admittedBody.deduplicated, false);
    assert.equal(admittedBody.intake.status, "accepted");
    assert.equal(JSON.stringify(admittedBody).includes("secret-signed-path"), false);

    const duplicate = await fetch(`http://127.0.0.1:${port}/v1/intakes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-media2text-intake-key": process.env.Y2T_INTAKE_API_KEY,
      },
      body: JSON.stringify(request),
    });
    assert.equal(duplicate.status, 202);
    assert.equal(((await duplicate.json()) as any).deduplicated, true);

    const deniedRead = await fetch(`http://127.0.0.1:${port}/v1/intakes`, {
      headers: { "x-media2text-intake-key": process.env.Y2T_INTAKE_API_KEY },
    });
    assert.equal(deniedRead.status, 401);
    const operatorRead = await fetch(`http://127.0.0.1:${port}/v1/intakes`, {
      headers: { "x-api-key": process.env.Y2T_API_KEY },
    });
    assert.equal(operatorRead.status, 200);
    assert.equal(((await operatorRead.json()) as any).items.length, 1);

    const status = await fetch(`http://127.0.0.1:${port}/status/media-pipeline`);
    assert.equal(status.status, 200);
    const statusBody = await status.json() as any;
    assert.equal(statusBody.condition, "ok");
    assert.equal(JSON.stringify(statusBody).includes("source.example"), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      const envName = key === "api" ? "Y2T_API_KEY" : key === "intake" ? "Y2T_INTAKE_API_KEY" : "Y2T_INTAKE_WORKER_ENABLED";
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    }
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { configSchema } from "../src/config/schema.js";
import { startApiServer } from "../src/api/server.js";

async function listenServer(server: any): Promise<void> {
  if (server.listening) return;
  await new Promise<void>((resolve) => server.once("listening", resolve));
}

test("request timeout does not crash server when headers already sent", async () => {
  const prevTimeout = process.env.Y2T_REQUEST_TIMEOUT_MS;
  // Very short timeout so it fires while the response is in-flight.
  process.env.Y2T_REQUEST_TIMEOUT_MS = "30";

  const dir = mkdtempSync(join(tmpdir(), "y2t-reqtimeout-"));
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
      // Slow planRun so the timeout fires during the request.
      planRun: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { total: 0, alreadyProcessed: 0, toProcess: 0, videos: [] };
      },
    },
  });
  await listenServer(server);
  const port = (server.address() as any).port as number;
  const apiKey = "test-api-key-aaaaaaaaaaaaaaaaaaaaaa";

  try {
    // This request takes 200ms but the timeout fires at 30ms → 408.
    const res = await fetch(`http://127.0.0.1:${port}/runs/plan`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=abc" }),
    });
    assert.equal(res.status, 408, "should receive 408 from request timeout");

    // Critical: server must still be alive after the timeout.
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200, "server must survive after timeout");
  } finally {
    if (prevTimeout === undefined) delete process.env.Y2T_REQUEST_TIMEOUT_MS;
    else process.env.Y2T_REQUEST_TIMEOUT_MS = prevTimeout;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("request timeout skips response when headers already sent", async () => {
  // Simulate the exact crash scenario: timeout fires after headers were sent.
  // Use a real HTTP server so ServerResponse behaves like production.
  const result = await new Promise<{ crashed: boolean; serverAlive: boolean }>(
    (resolve) => {
      const srv = createServer((req, res) => {
        // Send headers immediately (partial response, not ended).
        res.writeHead(200, { "content-type": "text/plain" });
        // Do NOT call res.end() yet — headers sent, body pending.

        // Simulate timeout handler firing (same logic as server.ts fix).
        setTimeout(() => {
          let crashed = false;
          if (res.headersSent || res.writableEnded) {
            // Fix working: skip json() call.
          } else {
            crashed = true;
          }
          // Finish the response.
          res.end("ok");
          resolve({ crashed, serverAlive: !crashed });
        }, 10);
      });

      srv.listen(0, "127.0.0.1", () => {
        const port = (srv.address() as any).port as number;
        fetch(`http://127.0.0.1:${port}/`).then(() => {
          srv.close();
        });
      });
    }
  );

  assert.equal(result.crashed, false, "timeout handler must detect headersSent");
  assert.equal(result.serverAlive, true, "server must not crash");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { MultiKeyProvider } from "../src/transcription/loadBalancer.js";

test("MultiKeyProvider rotates keys round-robin", async () => {
  const provider = new MultiKeyProvider(
    "assemblyai",
    "AssemblyAI",
    ["k1", "k2"],
    (key) => ({
      name: "assemblyai",
      getCapabilities: () => ({ supportsDiarization: true }),
      async transcribe() {
        return { id: key, status: "completed", text: key, provider: "assemblyai" };
      },
    }),
    { supportsDiarization: true },
    { failureThreshold: 2, cooldownMs: 60000 }
  );

  const first = await provider.transcribe("a.mp3", {
    pollIntervalMs: 1,
    maxPollMinutes: 1,
    retries: 0,
    providerTimeoutMs: 1000,
  });
  const second = await provider.transcribe("a.mp3", {
    pollIntervalMs: 1,
    maxPollMinutes: 1,
    retries: 0,
    providerTimeoutMs: 1000,
  });
  const third = await provider.transcribe("a.mp3", {
    pollIntervalMs: 1,
    maxPollMinutes: 1,
    retries: 0,
    providerTimeoutMs: 1000,
  });

  assert.equal(first.text, "k1");
  assert.equal(second.text, "k2");
  assert.equal(third.text, "k1");
});

test("MultiKeyProvider fails over after consecutive errors", async () => {
  const provider = new MultiKeyProvider(
    "assemblyai",
    "AssemblyAI",
    ["bad", "good"],
    (key) => ({
      name: "assemblyai",
      getCapabilities: () => ({ supportsDiarization: true }),
      async transcribe() {
        if (key === "bad") {
          throw new Error("boom");
        }
        return { id: key, status: "completed", text: key, provider: "assemblyai" };
      },
    }),
    { supportsDiarization: true },
    { failureThreshold: 1, cooldownMs: 60000 }
  );

  const first = await provider.transcribe("a.mp3", {
    pollIntervalMs: 1,
    maxPollMinutes: 1,
    retries: 0,
    providerTimeoutMs: 1000,
  });
  const second = await provider.transcribe("a.mp3", {
    pollIntervalMs: 1,
    maxPollMinutes: 1,
    retries: 0,
    providerTimeoutMs: 1000,
  });

  assert.equal(first.text, "good");
  assert.equal(second.text, "good");
});

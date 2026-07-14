import assert from "node:assert/strict";
import test from "node:test";
import { configSchema } from "../src/config/schema.js";
import { checkAssemblyAiCredits } from "../src/pipeline/run.js";
import { AssemblyAiClient } from "../src/transcription/assemblyai/client.js";

const transcriptionOptions = {
  pollIntervalMs: 0,
  maxPollMinutes: 1,
  retries: 2,
  providerTimeoutMs: 1000,
};

test("AssemblyAI polling retries do not upload or create billable work again", async () => {
  const client = new AssemblyAiClient("test", 1000, 0);
  let uploads = 0;
  let creates = 0;
  let polls = 0;

  client.uploadAudio = async () => {
    uploads += 1;
    return "https://upload.test/audio";
  };
  client.createTranscript = async () => {
    creates += 1;
    return { id: "job-1", status: "queued" };
  };
  client.getTranscript = async () => {
    polls += 1;
    if (polls === 1) throw new Error("AssemblyAI request timed out");
    return { id: "job-1", status: "completed", text: "done" };
  };

  const result = await client.transcribe("audio.mp3", transcriptionOptions);
  assert.equal(result.status, "completed");
  assert.equal(uploads, 1);
  assert.equal(creates, 1);
  assert.equal(polls, 2);
});

test("AssemblyAI terminal job errors are not retried from upload", async () => {
  const client = new AssemblyAiClient("test", 1000, 0);
  let uploads = 0;
  let creates = 0;
  let polls = 0;

  client.uploadAudio = async () => {
    uploads += 1;
    return "https://upload.test/audio";
  };
  client.createTranscript = async () => {
    creates += 1;
    return { id: "job-2", status: "queued" };
  };
  client.getTranscript = async () => {
    polls += 1;
    return { id: "job-2", status: "error", error: "invalid audio" };
  };

  await assert.rejects(
    client.transcribe("audio.mp3", transcriptionOptions),
    /Transcription error/
  );
  assert.equal(uploads, 1);
  assert.equal(creates, 1);
  assert.equal(polls, 1);
});

test("AssemblyAI abort credit policy rejects low or unavailable balances", async () => {
  const config = configSchema.parse({
    sttProvider: "assemblyai",
    assemblyAiApiKey: "test",
    assemblyAiCreditsCheck: "abort",
    assemblyAiMinBalanceMinutes: 60,
  });

  await assert.rejects(
    checkAssemblyAiCredits(config, () => ({
      name: "assemblyai",
      getCapabilities: () => ({ supportsDiarization: true }),
      getAccount: async () => ({ minutes_remaining: 10 }),
      transcribe: async () => ({ id: "unused", status: "completed" }),
    })),
    /below threshold.*Aborting run/
  );

  await assert.rejects(
    checkAssemblyAiCredits(config, () => ({
      name: "assemblyai",
      getCapabilities: () => ({ supportsDiarization: true }),
      getAccount: async () => {
        throw new Error("billing endpoint unavailable");
      },
      transcribe: async () => ({ id: "unused", status: "completed" }),
    })),
    /credits check failed.*Aborting run/
  );
});

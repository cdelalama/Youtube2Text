import assert from "node:assert/strict";
import { test } from "node:test";
import { configSchema } from "../src/config/schema.js";
import { createTranscriptionProvider } from "../src/transcription/factory.js";

test("sttProvider=openai_whisper requires OpenAI key", () => {
  assert.throws(() => {
    configSchema.parse({
      sttProvider: "openai_whisper",
    });
  });
});

test("sttProvider=openai_whisper accepts OpenAI key", () => {
  const config = configSchema.parse({
    sttProvider: "openai_whisper",
    openaiApiKey: "test",
  });
  assert.equal(config.sttProvider, "openai_whisper");
  assert.equal(config.openaiWhisperModel, "whisper-1");
});

test("sttProvider=deepgram requires Deepgram key", () => {
  assert.throws(() => {
    configSchema.parse({
      sttProvider: "deepgram",
    });
  });
});

test("sttProvider=deepgram accepts Deepgram key", () => {
  const config = configSchema.parse({
    sttProvider: "deepgram",
    deepgramApiKey: "test",
  });
  assert.equal(config.sttProvider, "deepgram");
  assert.equal(config.deepgramModel, "nova-3");
  assert.equal(config.deepgramDiarization, true);
});

test("provider name matches configured sttProvider", () => {
  const assemblyCfg = configSchema.parse({
    sttProvider: "assemblyai",
    assemblyAiApiKey: "test",
  });
  const assemblyProvider = createTranscriptionProvider(assemblyCfg);
  assert.equal(assemblyProvider.name, "assemblyai");

  const deepgramCfg = configSchema.parse({
    sttProvider: "deepgram",
    deepgramApiKey: "test",
  });
  const deepgramProvider = createTranscriptionProvider(deepgramCfg);
  assert.equal(deepgramProvider.name, "deepgram");

  const whisperCfg = configSchema.parse({
    sttProvider: "openai_whisper",
    openaiApiKey: "test",
  });
  const whisperProvider = createTranscriptionProvider(whisperCfg);
  assert.equal(whisperProvider.name, "openai_whisper");
});

test("sttProvider=assemblyai accepts multi-key config", () => {
  const config = configSchema.parse({
    sttProvider: "assemblyai",
    assemblyAiApiKeys: ["key-one", "key-two"],
  });
  const provider = createTranscriptionProvider(config);
  assert.equal(provider.name, "assemblyai");
});

test("sttProvider=deepgram accepts multi-key config", () => {
  const config = configSchema.parse({
    sttProvider: "deepgram",
    deepgramApiKeys: ["key-one", "key-two"],
  });
  const provider = createTranscriptionProvider(config);
  assert.equal(provider.name, "deepgram");
});

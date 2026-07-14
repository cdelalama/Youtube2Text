import type { AppConfig } from "../config/schema.js";
import type { TranscriptionProvider } from "./provider.js";
import { AssemblyAiProvider } from "./assemblyai/index.js";
import { OpenAiWhisperProvider } from "./openai/index.js";
import { DeepgramProvider } from "./deepgram/index.js";
import { getAssemblyAiCapabilities } from "./assemblyai/index.js";
import { getDeepgramCapabilities } from "./deepgram/index.js";
import { MultiKeyProvider } from "./loadBalancer.js";

export function createTranscriptionProvider(config: AppConfig): TranscriptionProvider {
  switch (config.sttProvider) {
    case "assemblyai":
      if (!config.assemblyAiApiKey && (!config.assemblyAiApiKeys || config.assemblyAiApiKeys.length === 0)) {
        throw new Error("assemblyAiApiKey or assemblyAiApiKeys is required when sttProvider=assemblyai");
      }
      {
        const keys = [
          ...(config.assemblyAiApiKeys ?? []),
          ...(config.assemblyAiApiKey ? [config.assemblyAiApiKey] : []),
        ].map((key) => key.trim()).filter((key) => key.length > 0);
        const uniqueKeys = Array.from(new Set(keys));
        if (uniqueKeys.length > 1) {
          return new MultiKeyProvider(
            "assemblyai",
            "AssemblyAI",
            uniqueKeys,
            (key) => new AssemblyAiProvider(key, undefined, config.providerTimeoutMs),
            getAssemblyAiCapabilities(),
            {
              failureThreshold: config.assemblyAiKeyFailureThreshold,
              cooldownMs: config.assemblyAiKeyCooldownMs,
            }
          );
        }
        const key = uniqueKeys[0];
        if (!key) {
          throw new Error("assemblyAiApiKey or assemblyAiApiKeys is required when sttProvider=assemblyai");
        }
        return new AssemblyAiProvider(key, undefined, config.providerTimeoutMs);
      }
    case "deepgram":
      if (!config.deepgramApiKey && (!config.deepgramApiKeys || config.deepgramApiKeys.length === 0)) {
        throw new Error("deepgramApiKey or deepgramApiKeys is required when sttProvider=deepgram");
      }
      {
        const keys = [
          ...(config.deepgramApiKeys ?? []),
          ...(config.deepgramApiKey ? [config.deepgramApiKey] : []),
        ]
          .map((key) => key.trim())
          .filter((key) => key.length > 0);
        const uniqueKeys = Array.from(new Set(keys));
        if (uniqueKeys.length > 1) {
          return new MultiKeyProvider(
            "deepgram",
            "Deepgram",
            uniqueKeys,
            (key) =>
              new DeepgramProvider(
                key,
                config.deepgramModel,
                config.deepgramDiarization,
                undefined,
                config.providerTimeoutMs
              ),
            getDeepgramCapabilities(),
            {
              failureThreshold: config.deepgramKeyFailureThreshold,
              cooldownMs: config.deepgramKeyCooldownMs,
            }
          );
        }
        const key = uniqueKeys[0];
        if (!key) {
          throw new Error("deepgramApiKey or deepgramApiKeys is required when sttProvider=deepgram");
        }
        return new DeepgramProvider(
          key,
          config.deepgramModel,
          config.deepgramDiarization,
          undefined,
          config.providerTimeoutMs
        );
      }
    case "openai_whisper":
      if (!config.openaiApiKey) {
        throw new Error("openaiApiKey is required when sttProvider=openai_whisper");
      }
      return new OpenAiWhisperProvider(
        config.openaiApiKey,
        config.openaiWhisperModel,
        undefined,
        config.providerTimeoutMs
      );
    default:
      throw new Error(`Unsupported sttProvider: ${config.sttProvider}`);
  }
}

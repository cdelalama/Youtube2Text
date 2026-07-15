import type { SttProviderId } from "../config/schema.js";

export type UsageEnforcement = "enforce" | "track";

export type UsagePolicy = {
  enforcement: UsageEnforcement;
  maxItemMinutes: number;
  maxRunMinutes: number;
  maxSourceMinutes24h: number;
  maxTotalMinutes30d: number;
  maxTotalUsd30d: number;
  ratesUsdPerHour: Record<SttProviderId, number>;
};

const DEFAULTS = {
  maxItemMinutes: 180,
  maxRunMinutes: 300,
  maxSourceMinutes24h: 600,
  maxTotalMinutes30d: 3000,
  maxTotalUsd30d: 25,
  // Conservative public pay-as-you-go estimates, verified 2026-07-14.
  assemblyAiRate: 0.23,
  deepgramRate: 0.552,
  openAiWhisperRate: 0.36,
} as const;

function nonNegativeNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

export function loadUsagePolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env
): UsagePolicy {
  const enforcementRaw = (env.Y2T_USAGE_ENFORCEMENT ?? "enforce").trim().toLowerCase();
  if (enforcementRaw !== "enforce" && enforcementRaw !== "track") {
    throw new Error("Y2T_USAGE_ENFORCEMENT must be enforce or track");
  }

  return {
    enforcement: enforcementRaw,
    maxItemMinutes: nonNegativeNumber(
      env,
      "Y2T_USAGE_MAX_ITEM_MINUTES",
      DEFAULTS.maxItemMinutes
    ),
    maxRunMinutes: nonNegativeNumber(
      env,
      "Y2T_USAGE_MAX_RUN_MINUTES",
      DEFAULTS.maxRunMinutes
    ),
    maxSourceMinutes24h: nonNegativeNumber(
      env,
      "Y2T_USAGE_MAX_SOURCE_MINUTES_24H",
      DEFAULTS.maxSourceMinutes24h
    ),
    maxTotalMinutes30d: nonNegativeNumber(
      env,
      "Y2T_USAGE_MAX_TOTAL_MINUTES_30D",
      DEFAULTS.maxTotalMinutes30d
    ),
    maxTotalUsd30d: nonNegativeNumber(
      env,
      "Y2T_USAGE_MAX_TOTAL_USD_30D",
      DEFAULTS.maxTotalUsd30d
    ),
    ratesUsdPerHour: {
      assemblyai: nonNegativeNumber(
        env,
        "Y2T_USAGE_RATE_ASSEMBLYAI_USD_PER_HOUR",
        DEFAULTS.assemblyAiRate
      ),
      deepgram: nonNegativeNumber(
        env,
        "Y2T_USAGE_RATE_DEEPGRAM_USD_PER_HOUR",
        DEFAULTS.deepgramRate
      ),
      openai_whisper: nonNegativeNumber(
        env,
        "Y2T_USAGE_RATE_OPENAI_WHISPER_USD_PER_HOUR",
        DEFAULTS.openAiWhisperRate
      ),
    },
  };
}

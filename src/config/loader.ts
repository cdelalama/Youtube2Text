import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import YAML from "yaml";
import { configSchema, AppConfig } from "./schema.js";
import { readSettingsFileSync } from "./settings.js";

type PartialConfig = Partial<Record<keyof AppConfig, unknown>>;

function loadYamlConfig(path: string): PartialConfig {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  return YAML.parse(raw, { schema: "core" }) ?? {};
}

function loadEnvConfig(): PartialConfig {
  dotenv.config();
  const env = process.env;
  const getEnv = (primary: string, legacy?: string): string | undefined => {
    if (env[primary] !== undefined) return env[primary];
    if (legacy && env[legacy] !== undefined) return env[legacy];
    return undefined;
  };
  const parseOptionalBool = (raw: string | undefined): boolean | undefined => {
    if (raw === undefined) return undefined;
    const v = raw.trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes";
  };
  const parseOptionalNumber = (raw: string | undefined): number | undefined => {
    if (raw === undefined || raw.trim() === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const parseCsvList = (raw: string | undefined): string[] | undefined => {
    if (raw === undefined) return undefined;
    const values = raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return values.length > 0 ? values : undefined;
  };
  return {
    assemblyAiApiKey: env.ASSEMBLYAI_API_KEY,
    assemblyAiApiKeys: parseCsvList(getEnv("Y2T_ASSEMBLYAI_API_KEYS", "ASSEMBLYAI_API_KEYS")),
    assemblyAiKeyFailureThreshold: parseOptionalNumber(
      getEnv("Y2T_ASSEMBLYAI_KEY_FAILURES", "ASSEMBLYAI_KEY_FAILURES")
    ),
    assemblyAiKeyCooldownMs: parseOptionalNumber(
      getEnv("Y2T_ASSEMBLYAI_KEY_COOLDOWN_MS", "ASSEMBLYAI_KEY_COOLDOWN_MS")
    ),
    deepgramApiKey: getEnv("Y2T_DEEPGRAM_API_KEY", "DEEPGRAM_API_KEY"),
    deepgramApiKeys: parseCsvList(getEnv("Y2T_DEEPGRAM_API_KEYS", "DEEPGRAM_API_KEYS")),
    deepgramKeyFailureThreshold: parseOptionalNumber(
      getEnv("Y2T_DEEPGRAM_KEY_FAILURES", "DEEPGRAM_KEY_FAILURES")
    ),
    deepgramKeyCooldownMs: parseOptionalNumber(
      getEnv("Y2T_DEEPGRAM_KEY_COOLDOWN_MS", "DEEPGRAM_KEY_COOLDOWN_MS")
    ),
    deepgramModel: getEnv("Y2T_DEEPGRAM_MODEL", "DEEPGRAM_MODEL"),
    deepgramDiarization: parseOptionalBool(
      getEnv("Y2T_DEEPGRAM_DIARIZATION", "DEEPGRAM_DIARIZATION")
    ),
    openaiApiKey: getEnv("Y2T_OPENAI_API_KEY", "OPENAI_API_KEY"),
    sttProvider: getEnv("Y2T_STT_PROVIDER", "STT_PROVIDER"),
    openaiWhisperModel: getEnv("Y2T_OPENAI_WHISPER_MODEL", "OPENAI_WHISPER_MODEL"),
    maxAudioMB: parseOptionalNumber(getEnv("Y2T_MAX_AUDIO_MB", "MAX_AUDIO_MB")),
    splitOverlapSeconds: parseOptionalNumber(getEnv("Y2T_SPLIT_OVERLAP_SECONDS", "SPLIT_OVERLAP_SECONDS")),
    outputDir: getEnv("Y2T_OUTPUT_DIR", "OUTPUT_DIR"),
    audioDir: getEnv("Y2T_AUDIO_DIR", "AUDIO_DIR"),
    filenameStyle: getEnv("Y2T_FILENAME_STYLE", "FILENAME_STYLE"),
    audioFormat: getEnv("Y2T_AUDIO_FORMAT", "AUDIO_FORMAT"),
    languageDetection: getEnv("Y2T_LANGUAGE_DETECTION", "LANGUAGE_DETECTION"),
    languageCode: getEnv("Y2T_LANGUAGE_CODE", "LANGUAGE_CODE"),
    concurrency: parseOptionalNumber(getEnv("Y2T_CONCURRENCY", "CONCURRENCY")),
    maxNewVideos: parseOptionalNumber(getEnv("Y2T_MAX_NEW_VIDEOS", "MAX_NEW_VIDEOS")),
    afterDate: getEnv("Y2T_AFTER_DATE", "AFTER_DATE"),
    csvEnabled: parseOptionalBool(getEnv("Y2T_CSV_ENABLED", "CSV_ENABLED")),
    assemblyAiCreditsCheck: getEnv("Y2T_ASSEMBLYAI_CREDITS_CHECK", "ASSEMBLYAI_CREDITS_CHECK"),
    assemblyAiMinBalanceMinutes: parseOptionalNumber(
      getEnv("Y2T_ASSEMBLYAI_MIN_BALANCE_MINUTES", "ASSEMBLYAI_MIN_BALANCE_MINUTES")
    ),
    commentsEnabled: parseOptionalBool(getEnv("Y2T_COMMENTS_ENABLED", "COMMENTS_ENABLED")),
    commentsMax: parseOptionalNumber(getEnv("Y2T_COMMENTS_MAX", "COMMENTS_MAX")),
    pollIntervalMs: parseOptionalNumber(getEnv("Y2T_POLL_INTERVAL_MS", "POLL_INTERVAL_MS")),
    maxPollMinutes: parseOptionalNumber(getEnv("Y2T_MAX_POLL_MINUTES", "MAX_POLL_MINUTES")),
    downloadRetries: parseOptionalNumber(getEnv("Y2T_DOWNLOAD_RETRIES", "DOWNLOAD_RETRIES")),
    transcriptionRetries: parseOptionalNumber(getEnv("Y2T_TRANSCRIPTION_RETRIES", "TRANSCRIPTION_RETRIES")),
    providerTimeoutMs: parseOptionalNumber(getEnv("Y2T_PROVIDER_TIMEOUT_MS", "PROVIDER_TIMEOUT_MS")),
    catalogMaxAgeHours: parseOptionalNumber(getEnv("Y2T_CATALOG_MAX_AGE_HOURS", "CATALOG_MAX_AGE_HOURS")),
    ytDlpPath: getEnv("Y2T_YT_DLP_PATH", "YT_DLP_PATH") || env.YTDLP_PATH,
  };
}

function filterUndefined(obj: PartialConfig): PartialConfig {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== "")
  );
}

export type ConfigSourceSnapshots = {
  outputDirCandidate: string;
  settingsFile: ReturnType<typeof readSettingsFileSync>;
  settingsConfig: PartialConfig;
  yamlConfig: PartialConfig;
  envConfig: PartialConfig;
};

export function loadConfigSourceSnapshots(
  configPath = "config.yaml",
  opts?: { outputDirOverride?: string }
): ConfigSourceSnapshots {
  const yamlConfig = loadYamlConfig(resolve(configPath));
  const envConfig = filterUndefined(loadEnvConfig());

  const outputDirCandidate =
    typeof opts?.outputDirOverride === "string" && opts.outputDirOverride.length > 0
      ? opts.outputDirOverride
      : (typeof envConfig.outputDir === "string" && envConfig.outputDir.length > 0
          ? envConfig.outputDir
          : typeof yamlConfig.outputDir === "string" && (yamlConfig.outputDir as string).length > 0
            ? (yamlConfig.outputDir as string)
            : "output");

  const settingsFile = readSettingsFileSync(outputDirCandidate);
  const settingsConfig = settingsFile?.settings ?? {};

  return {
    outputDirCandidate,
    settingsFile,
    settingsConfig,
    yamlConfig,
    envConfig,
  };
}

export function loadConfig(configPath = "config.yaml"): AppConfig {
  const { settingsConfig, yamlConfig, envConfig } = loadConfigSourceSnapshots(configPath);

  // Precedence: settings (lowest) < config.yaml < .env (highest)
  const merged = { ...settingsConfig, ...yamlConfig, ...envConfig };
  return configSchema.parse(merged);
}

import type { AppConfig } from "../config/schema.js";
import {
  applySettingsToConfig,
  pickNonSecretSettings,
  readSettingsFile,
  sanitizeNonSecretSettings,
  settingsPath,
  writeSettingsFile,
  type NonSecretSettingSource,
  type NonSecretSettings,
} from "../config/settings.js";
import { loadConfigSourceSnapshots } from "../config/loader.js";

export type SettingsGetResponse = {
  outputDir: string;
  settingsPath: string;
  updatedAt?: string;
  settings: Partial<NonSecretSettings>;
  effective: NonSecretSettings;
  sources: Record<keyof NonSecretSettings, NonSecretSettingSource>;
};

export type SettingsPatchRequest = {
  // Values may be null to clear a field (remove it from the settings file).
  settings: Partial<Record<keyof NonSecretSettings, NonSecretSettings[keyof NonSecretSettings] | null>>;
};

export async function getSettingsResponse(baseConfig: AppConfig): Promise<SettingsGetResponse> {
  const file = await readSettingsFile(baseConfig.outputDir);
  const settings = sanitizeNonSecretSettings(file?.settings);
  const effectiveConfig = applySettingsToConfig(baseConfig, settings);
  const effective = pickNonSecretSettings(effectiveConfig);
  const sources = computeNonSecretSettingSources(baseConfig.outputDir, effective);
  return {
    outputDir: baseConfig.outputDir,
    settingsPath: settingsPath(baseConfig.outputDir),
    updatedAt: file?.updatedAt,
    settings,
    effective,
    sources,
  };
}

export async function patchSettings(
  baseConfig: AppConfig,
  req: SettingsPatchRequest
): Promise<SettingsGetResponse> {
  const current = await readSettingsFile(baseConfig.outputDir);
  const currentSettings = sanitizeNonSecretSettings(current?.settings);

  const updates = sanitizeNonSecretSettings(req.settings ?? {});
  const clearKeys = new Set<keyof NonSecretSettings>();
  for (const [key, value] of Object.entries(req.settings ?? {})) {
    if (value === null) clearKeys.add(key as keyof NonSecretSettings);
  }
  const merged = { ...currentSettings, ...updates };
  for (const key of clearKeys) {
    delete merged[key];
  }
  await writeSettingsFile(baseConfig.outputDir, merged);
  return getSettingsResponse(baseConfig);
}

function computeNonSecretSettingSources(
  outputDir: string,
  effective: NonSecretSettings
): Record<keyof NonSecretSettings, NonSecretSettingSource> {
  const { settingsConfig, yamlConfig, envConfig } = loadConfigSourceSnapshots("config.yaml", {
    outputDirOverride: outputDir,
  });

  const envHas = (key: keyof NonSecretSettings): boolean => {
    const envVars = envVarsForSetting(key);
    if (envVars.length === 0) return false;
    return envVars.some((envVar) => process.env[envVar] !== undefined);
  };

  const sourceFor = (key: keyof NonSecretSettings): NonSecretSettingSource => {
    // env wins (if the env var is set and it produced a defined config value)
    if (envHas(key) && (envConfig as any)[key] !== undefined) return "env";
    // yaml wins over settings file
    if ((yamlConfig as any)[key] !== undefined) return "config.yaml";
    // settings file is lowest
    if ((settingsConfig as any)[key] !== undefined) return "settingsFile";
    // otherwise: schema default or unset optional
    return (effective as any)[key] === undefined ? "unset" : "default";
  };

  const keys: (keyof NonSecretSettings)[] = [
    "filenameStyle",
    "audioFormat",
    "sttProvider",
    "deepgramModel",
    "deepgramDiarization",
    "openaiWhisperModel",
    "maxAudioMB",
    "splitOverlapSeconds",
    "languageDetection",
    "languageCode",
    "concurrency",
    "maxNewVideos",
    "afterDate",
    "csvEnabled",
    "commentsEnabled",
    "commentsMax",
    "pollIntervalMs",
    "maxPollMinutes",
    "downloadRetries",
    "transcriptionRetries",
    "providerTimeoutMs",
    "catalogMaxAgeHours",
  ];

  const out: Partial<Record<keyof NonSecretSettings, NonSecretSettingSource>> = {};
  for (const k of keys) out[k] = sourceFor(k);
  return out as Record<keyof NonSecretSettings, NonSecretSettingSource>;
}

function envVarsForSetting(key: keyof NonSecretSettings): string[] {
  switch (key) {
    case "filenameStyle":
      return ["Y2T_FILENAME_STYLE", "FILENAME_STYLE"];
    case "audioFormat":
      return ["Y2T_AUDIO_FORMAT", "AUDIO_FORMAT"];
    case "sttProvider":
      return ["Y2T_STT_PROVIDER", "STT_PROVIDER"];
    case "openaiWhisperModel":
      return ["Y2T_OPENAI_WHISPER_MODEL", "OPENAI_WHISPER_MODEL"];
    case "deepgramModel":
      return ["Y2T_DEEPGRAM_MODEL", "DEEPGRAM_MODEL"];
    case "deepgramDiarization":
      return ["Y2T_DEEPGRAM_DIARIZATION", "DEEPGRAM_DIARIZATION"];
    case "maxAudioMB":
      return ["Y2T_MAX_AUDIO_MB", "MAX_AUDIO_MB"];
    case "splitOverlapSeconds":
      return ["Y2T_SPLIT_OVERLAP_SECONDS", "SPLIT_OVERLAP_SECONDS"];
    case "languageDetection":
      return ["Y2T_LANGUAGE_DETECTION", "LANGUAGE_DETECTION"];
    case "languageCode":
      return ["Y2T_LANGUAGE_CODE", "LANGUAGE_CODE"];
    case "concurrency":
      return ["Y2T_CONCURRENCY", "CONCURRENCY"];
    case "maxNewVideos":
      return ["Y2T_MAX_NEW_VIDEOS", "MAX_NEW_VIDEOS"];
    case "afterDate":
      return ["Y2T_AFTER_DATE", "AFTER_DATE"];
    case "csvEnabled":
      return ["Y2T_CSV_ENABLED", "CSV_ENABLED"];
    case "commentsEnabled":
      return ["Y2T_COMMENTS_ENABLED", "COMMENTS_ENABLED"];
    case "commentsMax":
      return ["Y2T_COMMENTS_MAX", "COMMENTS_MAX"];
    case "pollIntervalMs":
      return ["Y2T_POLL_INTERVAL_MS", "POLL_INTERVAL_MS"];
    case "maxPollMinutes":
      return ["Y2T_MAX_POLL_MINUTES", "MAX_POLL_MINUTES"];
    case "downloadRetries":
      return ["Y2T_DOWNLOAD_RETRIES", "DOWNLOAD_RETRIES"];
    case "transcriptionRetries":
      return ["Y2T_TRANSCRIPTION_RETRIES", "TRANSCRIPTION_RETRIES"];
    case "providerTimeoutMs":
      return ["Y2T_PROVIDER_TIMEOUT_MS", "PROVIDER_TIMEOUT_MS"];
    case "catalogMaxAgeHours":
      return ["Y2T_CATALOG_MAX_AGE_HOURS"];
    default:
      return [];
  }
}

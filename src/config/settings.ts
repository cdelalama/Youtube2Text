import { join } from "node:path";
import { promises as fs } from "node:fs";
import { readFileSync } from "node:fs";
import type { AppConfig } from "./schema.js";
import { ensureDir, writeJson } from "../utils/fs.js";

export type SettingsFile = {
  version: 1;
  updatedAt: string;
  settings: Partial<NonSecretSettings>;
};

// Only allow non-secret defaults here. Never store secrets in output/.
export type NonSecretSettings = Pick<
  AppConfig,
  | "filenameStyle"
  | "audioFormat"
  | "sttProvider"
  | "deepgramModel"
  | "deepgramDiarization"
  | "openaiWhisperModel"
  | "maxAudioMB"
  | "splitOverlapSeconds"
  | "languageDetection"
  | "languageCode"
  | "concurrency"
  | "maxNewVideos"
  | "afterDate"
  | "csvEnabled"
  | "commentsEnabled"
  | "commentsMax"
  | "pollIntervalMs"
  | "maxPollMinutes"
  | "downloadRetries"
  | "transcriptionRetries"
  | "providerTimeoutMs"
  | "catalogMaxAgeHours"
>;

export type NonSecretSettingSource = "env" | "config.yaml" | "settingsFile" | "default" | "unset";

export function settingsPath(outputDir: string): string {
  return join(outputDir, "_settings.json");
}

export async function readSettingsFile(outputDir: string): Promise<SettingsFile | undefined> {
  try {
    const raw = await fs.readFile(settingsPath(outputDir), "utf8");
    const json = JSON.parse(raw) as SettingsFile;
    if (json?.version !== 1) return undefined;
    if (typeof json.updatedAt !== "string") return undefined;
    if (!json.settings || typeof json.settings !== "object") return undefined;
    return json;
  } catch {
    return undefined;
  }
}

export function readSettingsFileSync(outputDir: string): SettingsFile | undefined {
  try {
    const raw = readFileSync(settingsPath(outputDir), "utf8");
    const json = JSON.parse(raw) as SettingsFile;
    if (json?.version !== 1) return undefined;
    if (typeof json.updatedAt !== "string") return undefined;
    if (!json.settings || typeof json.settings !== "object") return undefined;
    return json;
  } catch {
    return undefined;
  }
}

export async function writeSettingsFile(
  outputDir: string,
  settings: Partial<NonSecretSettings>
): Promise<SettingsFile> {
  const file: SettingsFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    settings,
  };
  await ensureDir(outputDir);
  await writeJson(settingsPath(outputDir), file);
  return file;
}

export function sanitizeNonSecretSettings(input: unknown): Partial<NonSecretSettings> {
  if (!input || typeof input !== "object") return {};
  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const allow = <K extends keyof NonSecretSettings>(key: K, value: unknown) => {
    if (value === undefined) return;
    out[key as string] = value;
  };

  allow("filenameStyle", obj.filenameStyle);
  allow("audioFormat", obj.audioFormat);
  allow("sttProvider", obj.sttProvider);
  allow("deepgramModel", obj.deepgramModel);
  allow("deepgramDiarization", obj.deepgramDiarization);
  allow("openaiWhisperModel", obj.openaiWhisperModel);
  allow("maxAudioMB", obj.maxAudioMB);
  allow("splitOverlapSeconds", obj.splitOverlapSeconds);
  allow("languageDetection", obj.languageDetection);
  allow("languageCode", obj.languageCode);
  allow("concurrency", obj.concurrency);
  allow("maxNewVideos", obj.maxNewVideos);
  allow("afterDate", obj.afterDate);
  allow("csvEnabled", obj.csvEnabled);
  allow("commentsEnabled", obj.commentsEnabled);
  allow("commentsMax", obj.commentsMax);
  allow("pollIntervalMs", obj.pollIntervalMs);
  allow("maxPollMinutes", obj.maxPollMinutes);
  allow("downloadRetries", obj.downloadRetries);
  allow("transcriptionRetries", obj.transcriptionRetries);
  allow("providerTimeoutMs", obj.providerTimeoutMs);
  allow("catalogMaxAgeHours", obj.catalogMaxAgeHours);

  // Remove nulls (API may use null to mean "clear")
  for (const [k, v] of Object.entries(out)) {
    if (v === null) delete out[k];
  }

  return out as Partial<NonSecretSettings>;
}

export function applySettingsToConfig(baseConfig: AppConfig, settings: Partial<NonSecretSettings>): AppConfig {
  return { ...baseConfig, ...settings };
}

export function pickNonSecretSettings(config: AppConfig): NonSecretSettings {
  return {
    filenameStyle: config.filenameStyle,
    audioFormat: config.audioFormat,
    sttProvider: config.sttProvider,
    deepgramModel: config.deepgramModel,
    deepgramDiarization: config.deepgramDiarization,
    openaiWhisperModel: config.openaiWhisperModel,
    maxAudioMB: config.maxAudioMB,
    splitOverlapSeconds: config.splitOverlapSeconds,
    languageDetection: config.languageDetection,
    languageCode: config.languageCode,
    concurrency: config.concurrency,
    maxNewVideos: config.maxNewVideos,
    afterDate: config.afterDate,
    csvEnabled: config.csvEnabled,
    commentsEnabled: config.commentsEnabled,
    commentsMax: config.commentsMax,
    pollIntervalMs: config.pollIntervalMs,
    maxPollMinutes: config.maxPollMinutes,
    downloadRetries: config.downloadRetries,
    transcriptionRetries: config.transcriptionRetries,
    providerTimeoutMs: config.providerTimeoutMs,
    catalogMaxAgeHours: config.catalogMaxAgeHours,
  };
}

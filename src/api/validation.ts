import type { AppConfig } from "../config/schema.js";
import type { NonSecretSettings } from "../config/settings.js";
import { normalizeAssemblyAiLanguageCode } from "../youtube/language.js";

export type ValidationResult<T> = {
  value: T;
  errors: string[];
};

type IntBounds = { min: number; max: number };

const LIMITS = {
  concurrency: { min: 1, max: 10 },
  maxNewVideos: { min: 1, max: 5000 },
  commentsMax: { min: 1, max: 2000 },
  pollIntervalMs: { min: 1000, max: 60000 },
  maxPollMinutes: { min: 1, max: 240 },
  downloadRetries: { min: 0, max: 10 },
  transcriptionRetries: { min: 0, max: 10 },
  maxAudioMB: { min: 1, max: 50000 },
  splitOverlapSeconds: { min: 0, max: 30 },
  catalogMaxAgeHours: { min: -1, max: 8760 },
} as const satisfies Record<string, IntBounds>;

function clampInt(value: number, bounds: IntBounds): number {
  if (value < bounds.min) return bounds.min;
  if (value > bounds.max) return bounds.max;
  return value;
}

function normalizeOptionalInt(
  field: string,
  raw: unknown,
  bounds: IntBounds,
  errors: string[]
): number | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    errors.push(`${field} must be a number`);
    return undefined;
  }
  const n = Math.trunc(raw);
  return clampInt(n, bounds);
}

function normalizeOptionalBool(
  field: string,
  raw: unknown,
  errors: string[]
): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return undefined;
  if (typeof raw !== "boolean") {
    errors.push(`${field} must be a boolean`);
    return undefined;
  }
  return raw;
}

function normalizeOptionalEnum<T extends string>(
  field: string,
  raw: unknown,
  allowed: readonly T[],
  errors: string[]
): T | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return undefined;
  if (typeof raw !== "string") {
    errors.push(`${field} must be a string`);
    return undefined;
  }
  const v = raw.trim();
  if (!allowed.includes(v as T)) {
    errors.push(`${field} must be one of: ${allowed.join(", ")}`);
    return undefined;
  }
  return v as T;
}

function normalizeOptionalString(
  field: string,
  raw: unknown,
  errors: string[]
): string | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return undefined;
  if (typeof raw !== "string") {
    errors.push(`${field} must be a string`);
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    errors.push(`${field} must not be empty`);
    return undefined;
  }
  return trimmed;
}

function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return false;
  return true;
}

function normalizeOptionalDate(field: string, raw: unknown, errors: string[]): string | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return undefined;
  if (typeof raw !== "string") {
    errors.push(`${field} must be a string (YYYY-MM-DD)`);
    return undefined;
  }
  const trimmed = raw.trim();
  if (!isValidIsoDate(trimmed)) {
    errors.push(`${field} must be YYYY-MM-DD`);
    return undefined;
  }
  return trimmed;
}

function normalizeOptionalLanguageCode(
  field: string,
  raw: unknown,
  errors: string[]
): string | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return undefined;
  if (typeof raw !== "string") {
    errors.push(`${field} must be a string`);
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    errors.push(`${field} must not be empty`);
    return undefined;
  }
  const normalized = normalizeAssemblyAiLanguageCode(trimmed);
  if (!normalized) {
    errors.push(`${field} must be a supported AssemblyAI language code`);
    return undefined;
  }
  return normalized;
}

export function normalizeNonSecretSettings(
  input: Partial<NonSecretSettings>
): ValidationResult<Partial<NonSecretSettings>> {
  const errors: string[] = [];
  const out: Partial<NonSecretSettings> = {};

  const filenameStyle = normalizeOptionalEnum(
    "filenameStyle",
    input.filenameStyle,
    ["id", "id_title", "title_id"],
    errors
  );
  if (filenameStyle !== undefined) out.filenameStyle = filenameStyle;

  const audioFormat = normalizeOptionalEnum(
    "audioFormat",
    input.audioFormat,
    ["mp3", "wav"],
    errors
  );
  if (audioFormat !== undefined) out.audioFormat = audioFormat;

  const sttProvider = normalizeOptionalEnum(
    "sttProvider",
    input.sttProvider,
    ["assemblyai", "deepgram", "openai_whisper"],
    errors
  );
  if (sttProvider !== undefined) out.sttProvider = sttProvider;

  const deepgramModel = normalizeOptionalString(
    "deepgramModel",
    input.deepgramModel,
    errors
  );
  if (deepgramModel !== undefined) out.deepgramModel = deepgramModel;

  const deepgramDiarization = normalizeOptionalBool(
    "deepgramDiarization",
    input.deepgramDiarization,
    errors
  );
  if (deepgramDiarization !== undefined) out.deepgramDiarization = deepgramDiarization;

  const openaiWhisperModel = normalizeOptionalString(
    "openaiWhisperModel",
    input.openaiWhisperModel,
    errors
  );
  if (openaiWhisperModel !== undefined) out.openaiWhisperModel = openaiWhisperModel;

  const maxAudioMB = normalizeOptionalInt("maxAudioMB", input.maxAudioMB, LIMITS.maxAudioMB, errors);
  if (maxAudioMB !== undefined) out.maxAudioMB = maxAudioMB;

  const splitOverlapSeconds = normalizeOptionalInt(
    "splitOverlapSeconds",
    input.splitOverlapSeconds,
    LIMITS.splitOverlapSeconds,
    errors
  );
  if (splitOverlapSeconds !== undefined) out.splitOverlapSeconds = splitOverlapSeconds;

  const languageDetection = normalizeOptionalEnum(
    "languageDetection",
    input.languageDetection,
    ["auto", "manual"],
    errors
  );
  if (languageDetection !== undefined) out.languageDetection = languageDetection;

  const languageCode = normalizeOptionalLanguageCode("languageCode", input.languageCode, errors);
  if (languageCode !== undefined) out.languageCode = languageCode;

  const concurrency = normalizeOptionalInt("concurrency", input.concurrency, LIMITS.concurrency, errors);
  if (concurrency !== undefined) out.concurrency = concurrency;

  const maxNewVideos = normalizeOptionalInt("maxNewVideos", input.maxNewVideos, LIMITS.maxNewVideos, errors);
  if (maxNewVideos !== undefined) out.maxNewVideos = maxNewVideos;

  const afterDate = normalizeOptionalDate("afterDate", input.afterDate, errors);
  if (afterDate !== undefined) out.afterDate = afterDate;

  const csvEnabled = normalizeOptionalBool("csvEnabled", input.csvEnabled, errors);
  if (csvEnabled !== undefined) out.csvEnabled = csvEnabled;

  const commentsEnabled = normalizeOptionalBool("commentsEnabled", input.commentsEnabled, errors);
  if (commentsEnabled !== undefined) out.commentsEnabled = commentsEnabled;

  const commentsMax = normalizeOptionalInt("commentsMax", input.commentsMax, LIMITS.commentsMax, errors);
  if (commentsMax !== undefined) out.commentsMax = commentsMax;

  const pollIntervalMs = normalizeOptionalInt("pollIntervalMs", input.pollIntervalMs, LIMITS.pollIntervalMs, errors);
  if (pollIntervalMs !== undefined) out.pollIntervalMs = pollIntervalMs;

  const maxPollMinutes = normalizeOptionalInt("maxPollMinutes", input.maxPollMinutes, LIMITS.maxPollMinutes, errors);
  if (maxPollMinutes !== undefined) out.maxPollMinutes = maxPollMinutes;

  const downloadRetries = normalizeOptionalInt("downloadRetries", input.downloadRetries, LIMITS.downloadRetries, errors);
  if (downloadRetries !== undefined) out.downloadRetries = downloadRetries;

  const transcriptionRetries = normalizeOptionalInt(
    "transcriptionRetries",
    input.transcriptionRetries,
    LIMITS.transcriptionRetries,
    errors
  );
  if (transcriptionRetries !== undefined) out.transcriptionRetries = transcriptionRetries;

  const catalogMaxAgeHours = normalizeOptionalInt(
    "catalogMaxAgeHours",
    input.catalogMaxAgeHours,
    LIMITS.catalogMaxAgeHours,
    errors
  );
  if (catalogMaxAgeHours !== undefined) out.catalogMaxAgeHours = catalogMaxAgeHours;

  return { value: out, errors };
}

export function normalizeConfigOverrides(
  overrides: Partial<AppConfig>
): ValidationResult<Partial<AppConfig>> {
  const errors: string[] = [];
  const out: Partial<AppConfig> = { ...overrides };

  const normalized = normalizeNonSecretSettings(overrides as Partial<NonSecretSettings>);
  errors.push(...normalized.errors);
  Object.assign(out, normalized.value);

  return { value: out, errors };
}

export function getValidationLimits() {
  return LIMITS;
}

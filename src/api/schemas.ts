import { z } from "zod";
import { normalizeAssemblyAiLanguageCode } from "../youtube/language.js";

const optionalString = () =>
  z.preprocess((value) => (value === null ? undefined : value), z.string().optional());
const optionalUrl = () =>
  z.preprocess((value) => (value === null ? undefined : value), z.string().url().optional());
const optionalBoolean = () =>
  z.preprocess((value) => (value === null ? undefined : value), z.boolean().optional());

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
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

const optionalClampedInt = (min: number, max: number) =>
  z.preprocess(
    (value) => {
      if (value === null || value === undefined) return undefined;
      if (typeof value !== "number" || !Number.isFinite(value)) return value;
      return clampInt(Math.trunc(value), min, max);
    },
    z.number().int().min(min).max(max).optional()
  );

const optionalClampedIntOrNull = (min: number, max: number) =>
  z.preprocess(
    (value) => {
      if (value === null) return null;
      if (value === undefined) return undefined;
      if (typeof value !== "number" || !Number.isFinite(value)) return value;
      return clampInt(Math.trunc(value), min, max);
    },
    z.union([z.number().int().min(min).max(max), z.literal(null)]).optional()
  );

const optionalIsoDateOrEmpty = () =>
  z.preprocess(
    (value) => {
      if (value === null || value === undefined) return undefined;
      if (typeof value !== "string") return value;
      return value.trim();
    },
    z
      .union([
        z.literal(""),
        z.string().refine((v) => isValidIsoDate(v), {
          message: "must be YYYY-MM-DD",
        }),
      ])
      .optional()
  );

const optionalIsoDateOrEmptyOrNull = () =>
  z.preprocess(
    (value) => {
      if (value === null) return null;
      if (value === undefined) return undefined;
      if (typeof value !== "string") return value;
      return value.trim();
    },
    z
      .union([
        z.literal(""),
        z.string().refine((v) => isValidIsoDate(v), {
          message: "must be YYYY-MM-DD",
        }),
        z.literal(null),
      ])
      .optional()
  );

const optionalBooleanOrNull = () =>
  z.preprocess(
    (value) => (value === undefined ? undefined : value),
    z.union([z.boolean(), z.literal(null)]).optional()
  );

const optionalStringOrNull = () =>
  z.preprocess(
    (value) => (value === undefined ? undefined : value),
    z.union([z.string(), z.literal(null)]).optional()
  );

const optionalEnumOrNull = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess(
    (value) => (value === undefined ? undefined : value),
    z.union([z.enum(values), z.literal(null)]).optional()
  );

const safeConfigRecord = () =>
  z
    .record(z.unknown())
    .superRefine((value, ctx) => {
      for (const key of ["__proto__", "constructor", "prototype"]) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `config must not include ${key}`,
          });
        }
      }
    });

const optionalLanguageCodeOrNull = () =>
  z.preprocess(
    (value) => (value === undefined ? undefined : value),
    z
      .union([
        z
          .string()
          .transform((raw, ctx) => {
            const normalized = normalizeAssemblyAiLanguageCode(raw.trim());
            if (!normalized) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "languageCode must be a supported AssemblyAI language code",
              });
              return z.NEVER;
            }
            return normalized;
          }),
        z.literal(null),
      ])
      .optional()
  );

export const settingsPatchSchema = z.object({
  settings: z
    .object({
      filenameStyle: optionalEnumOrNull(["id", "id_title", "title_id"]),
      audioFormat: optionalEnumOrNull(["mp3", "wav"]),
      sttProvider: optionalEnumOrNull(["assemblyai", "deepgram", "openai_whisper"]),
      deepgramModel: optionalStringOrNull(),
      deepgramDiarization: optionalBooleanOrNull(),
      openaiWhisperModel: optionalStringOrNull(),
      maxAudioMB: optionalClampedIntOrNull(1, 50000),
      splitOverlapSeconds: optionalClampedIntOrNull(0, 30),
      languageDetection: optionalEnumOrNull(["auto", "manual"]),
      languageCode: optionalLanguageCodeOrNull(),
      concurrency: optionalClampedIntOrNull(1, 10),
      maxNewVideos: optionalClampedIntOrNull(1, 5000),
      afterDate: optionalIsoDateOrEmptyOrNull(),
      csvEnabled: optionalBooleanOrNull(),
      commentsEnabled: optionalBooleanOrNull(),
      commentsMax: optionalClampedIntOrNull(1, 2000),
      pollIntervalMs: optionalClampedIntOrNull(1000, 60000),
      maxPollMinutes: optionalClampedIntOrNull(1, 240),
      downloadRetries: optionalClampedIntOrNull(0, 10),
      transcriptionRetries: optionalClampedIntOrNull(0, 10),
      providerTimeoutMs: optionalClampedIntOrNull(1000, 600000),
      catalogMaxAgeHours: optionalClampedIntOrNull(-1, 8760),
    })
    .strict(),
});

export const watchlistCreateSchema = z.object({
  channelUrl: z.string().url(),
  intervalMinutes: optionalClampedInt(1, 10080),
  enabled: optionalBoolean(),
});

export const watchlistUpdateSchema = z.object({
  intervalMinutes: optionalClampedIntOrNull(1, 10080),
  enabled: optionalBoolean(),
});

const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const optionalVideoIds = () =>
  z.preprocess(
    (value) => (value === null ? undefined : value),
    z
      .array(z.string().regex(YOUTUBE_VIDEO_ID_RE, "invalid video ID format"))
      .max(5000)
      .optional()
  );

const runPlanBase = z.object({
  url: z.string().url(),
  force: optionalBoolean(),
  maxNewVideos: optionalClampedInt(1, 5000),
  afterDate: optionalIsoDateOrEmpty(),
  beforeDate: optionalIsoDateOrEmpty(),
  videoIds: optionalVideoIds(),
  config: safeConfigRecord().optional(),
});

export const runPlanSchema = runPlanBase.refine(
  (v) => {
    if (!v.afterDate || !v.beforeDate) return true;
    return v.beforeDate >= v.afterDate;
  },
  { message: "beforeDate must be >= afterDate" }
);

export const runCreateSchema = z
  .object({
  url: z.string().url().optional(),
  audioId: z.string().min(1).optional(),
  force: optionalBoolean(),
  maxNewVideos: optionalClampedInt(1, 5000),
  afterDate: optionalIsoDateOrEmpty(),
  beforeDate: optionalIsoDateOrEmpty(),
  videoIds: optionalVideoIds(),
  callbackUrl: optionalUrl(),
  config: safeConfigRecord().optional(),
  })
  .refine((value) => value.url || value.audioId, {
    message: "Either url or audioId is required",
  })
  .refine((value) => !(value.url && value.audioId), {
    message: "Provide either url or audioId, not both",
  })
  .refine(
    (v) => {
      if (!v.afterDate || !v.beforeDate) return true;
      return v.beforeDate >= v.afterDate;
    },
    { message: "beforeDate must be >= afterDate" }
  );

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/, "must be lowercase SHA-256 hex");
const stableId = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:@/-]+$/);

export const intakeCreateSchema = z
  .object({
    schemaVersion: z.literal("media2text.intake.v1"),
    eventId: stableId,
    idempotencyKey: stableId,
    correlationId: stableId.optional(),
    source: z
      .object({
        authority: stableId,
        itemId: stableId,
        collectionId: stableId.optional(),
        artifactRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        createdAt: z.string().datetime({ offset: true }).nullable().optional(),
        createdAtType: z.enum(["recorded", "published", "unknown"]).optional(),
      })
      .strict(),
    artifact: z
      .object({
        url: z.string().url().refine((value) => {
          const protocol = new URL(value).protocol;
          return protocol === "http:" || protocol === "https:";
        }, "artifact URL must use http or https"),
        sha256: sha256Hex,
        bytes: z.number().int().positive().max(10 * 1024 * 1024 * 1024),
        contentType: z.string().regex(/^audio\/[A-Za-z0-9.+-]+$/),
        durationSeconds: z.number().positive().max(7 * 24 * 60 * 60).optional(),
        filename: z.string().min(1).max(255).optional(),
      })
      .strict(),
    title: z.string().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.source.artifactRevision !== `sha256:${value.artifact.sha256}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source", "artifactRevision"],
        message: "must identify the declared artifact SHA-256",
      });
    }
  });

export type SettingsPatchInput = z.infer<typeof settingsPatchSchema>;
export type WatchlistCreateInput = z.infer<typeof watchlistCreateSchema>;
export type WatchlistUpdateInput = z.infer<typeof watchlistUpdateSchema>;
export type RunPlanInput = z.infer<typeof runPlanSchema>;
export type RunCreateInput = z.infer<typeof runCreateSchema>;
export type IntakeCreateInput = z.infer<typeof intakeCreateSchema>;

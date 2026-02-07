import { z } from "zod";

const safePathString = z
  .string()
  .min(1)
  .refine((value) => !/[\0\r\n]/.test(value), {
    message: "path must not include null bytes or newlines",
  });

const configObjectSchema = z.object({
  sttProvider: z.enum(["assemblyai", "deepgram", "openai_whisper"]).default("assemblyai"),
  assemblyAiApiKey: z.string().min(1).optional(),
  assemblyAiApiKeys: z.array(z.string().min(1)).optional(),
  assemblyAiKeyFailureThreshold: z.number().int().positive().default(2),
  assemblyAiKeyCooldownMs: z.number().int().positive().default(60000),
  deepgramApiKey: z.string().min(1).optional(),
  deepgramApiKeys: z.array(z.string().min(1)).optional(),
  deepgramKeyFailureThreshold: z.number().int().positive().default(2),
  deepgramKeyCooldownMs: z.number().int().positive().default(60000),
  deepgramModel: z.string().min(1).default("nova-3"),
  deepgramDiarization: z.boolean().default(true),
  openaiApiKey: z.string().min(1).optional(),
  openaiWhisperModel: z.string().min(1).default("whisper-1"),
  maxAudioMB: z.number().int().positive().optional(),
  splitOverlapSeconds: z.number().int().nonnegative().default(2),
  outputDir: z.string().default("output"),
  audioDir: z.string().default("audio"),
  filenameStyle: z.enum(["id", "id_title", "title_id"]).default("title_id"),
  audioFormat: z.enum(["mp3", "wav"]).default("mp3"),
  languageDetection: z.enum(["auto", "manual"]).default("auto"),
  languageCode: z.string().default("en_us"),
  concurrency: z.number().int().positive().default(2),
  maxNewVideos: z.number().int().positive().optional(),
  afterDate: z.string().optional(),
  csvEnabled: z.boolean().default(false),
  assemblyAiCreditsCheck: z
    .enum(["warn", "abort", "none"])
    .default("warn"),
  assemblyAiMinBalanceMinutes: z.number().int().positive().default(60),
  commentsEnabled: z.boolean().default(true),
  commentsMax: z.number().int().positive().default(100),
  pollIntervalMs: z.number().int().positive().default(5000),
  maxPollMinutes: z.number().int().positive().default(60),
  downloadRetries: z.number().int().nonnegative().default(2),
  transcriptionRetries: z.number().int().nonnegative().default(2),
  providerTimeoutMs: z.number().int().positive().default(120000),
  // Channel catalog cache TTL for exact planning. When exceeded, we force a full refresh.
  // Set <= 0 to disable TTL (cache never expires).
  catalogMaxAgeHours: z.number().int().default(168),
  ytDlpPath: safePathString.optional(),
});

export const configSchema = configObjectSchema.superRefine((cfg, ctx) => {
  if (cfg.sttProvider === "assemblyai" && !cfg.assemblyAiApiKey) {
    if (!cfg.assemblyAiApiKeys || cfg.assemblyAiApiKeys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "assemblyAiApiKey or assemblyAiApiKeys is required when sttProvider=assemblyai",
        path: ["assemblyAiApiKey"],
      });
    }
  }
  if (cfg.sttProvider === "openai_whisper" && !cfg.openaiApiKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "openaiApiKey is required when sttProvider=openai_whisper",
      path: ["openaiApiKey"],
    });
  }
  if (cfg.sttProvider === "deepgram" && !cfg.deepgramApiKey) {
    if (!cfg.deepgramApiKeys || cfg.deepgramApiKeys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "deepgramApiKey or deepgramApiKeys is required when sttProvider=deepgram",
        path: ["deepgramApiKey"],
      });
    }
  }
});

export const configSchemaBase = configObjectSchema;

export type SttProviderId = z.infer<typeof configObjectSchema.shape.sttProvider>;
export type AppConfig = z.infer<typeof configSchema>;

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";

const safePathString = z
  .string()
  .min(1)
  .refine((value) => !/[\0\r\n]/.test(value), {
    message: "path must not include null bytes or newlines",
  });

const runSchema = z
  .object({
  url: z.string().url().optional(),
  audioPath: safePathString.optional(),
  audioTitle: z.string().optional(),
  maxNewVideos: z.number().int().positive().optional(),
  after: z.string().optional(),
  outDir: safePathString.optional(),
  audioDir: safePathString.optional(),
  sttProvider: z.enum(["assemblyai", "deepgram", "openai_whisper"]).optional(),
  deepgramModel: z.string().optional(),
  deepgramDiarization: z.boolean().optional(),
  openaiWhisperModel: z.string().optional(),
  maxAudioMB: z.number().int().positive().optional(),
  splitOverlapSeconds: z.number().int().nonnegative().optional(),
  filenameStyle: z.enum(["id", "id_title", "title_id"]).optional(),
  audioFormat: z.enum(["mp3", "wav"]).optional(),
  languageDetection: z.enum(["auto", "manual"]).optional(),
  languageCode: z.string().optional(),
  concurrency: z.number().int().positive().optional(),
  csvEnabled: z.boolean().optional(),
  assemblyAiCreditsCheck: z.enum(["warn", "abort", "none"]).optional(),
  assemblyAiMinBalanceMinutes: z.number().int().positive().optional(),
  commentsEnabled: z.boolean().optional(),
  commentsMax: z.number().int().positive().optional(),
  force: z.boolean().optional(),
  ytDlpPath: safePathString.optional(),
  })
  .refine((value) => value.url || value.audioPath, {
    message: "runs entry must include url or audioPath",
  })
  .refine((value) => !(value.url && value.audioPath), {
    message: "Provide either url or audioPath, not both",
  });

const runsFileSchema = z.union([
  z.object({ runs: z.array(runSchema).min(1) }),
  z.array(runSchema).min(1),
]);

export type RunItem = z.infer<typeof runSchema>;

export function loadRunsFile(
  path = "runs.yaml"
): RunItem[] | undefined {
  let fullPath = resolve(path);
  if (!existsSync(fullPath) && path === "runs.yaml") {
    const alt = resolve("runs.yml");
    if (existsSync(alt)) fullPath = alt;
  }
  if (!existsSync(fullPath)) return undefined;
  const raw = readFileSync(fullPath, "utf8");
  const parsed = YAML.parse(raw, { schema: "core" });
  const validated = runsFileSchema.parse(parsed);
  return Array.isArray(validated) ? validated : validated.runs;
}

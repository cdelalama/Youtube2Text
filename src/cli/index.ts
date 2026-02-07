#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig, loadRunsFile } from "../config/index.js";
import { logError } from "../utils/logger.js";
import { runPipeline } from "../pipeline/run.js";
import { JsonLinesEventEmitter } from "../pipeline/jsonlEmitter.js";
import { classifyYoutubeUrl } from "../youtube/url.js";
import { readFileSync, promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename as pathBasename, extname, resolve as pathResolve } from "node:path";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf8")
);

const program = new Command();

program
  .name("youtube2text")
  .version(pkg.version)
  .argument("[url]", "YouTube channel, playlist, or video URL")
  .option("--audio <path>", "Transcribe a local audio file instead of YouTube")
  .option("--audioTitle <title>", "Title to use for a local audio run")
  .option(
    "--maxNewVideos <n>",
    "Maximum NEW (unprocessed) videos to process",
    (v) => Number(v)
  )
  .option("--after <date>", "Only videos after YYYY-MM-DD")
  .option("--outDir <path>", "Output directory")
  .option("--audioDir <path>", "Audio directory")
  .option(
    "--filenameStyle <style>",
    "Output filename style: id | id_title | title_id"
  )
  .option("--audioFormat <fmt>", "mp3 or wav")
  .option(
    "--sttProvider <provider>",
    "Speech-to-text provider (assemblyai | deepgram | openai_whisper)"
  )
  .option("--deepgramModel <name>", "Deepgram model (default nova-3)")
  .option("--deepgramDiarization <bool>", "Deepgram diarization: true | false")
  .option("--openaiWhisperModel <name>", "OpenAI Whisper model (default whisper-1)")
  .option("--maxAudioMB <n>", "Max audio size before splitting (MB)", (v) => Number(v))
  .option(
    "--splitOverlapSeconds <n>",
    "Overlap seconds between chunks when splitting",
    (v) => Number(v)
  )
  .option("--language <code>", "Language code (used when manual)")
  .option(
    "--languageDetection <mode>",
    "Language detection: auto | manual"
  )
  .option("--concurrency <n>", "Parallel videos", (v) => Number(v))
  .option("--csv", "Enable CSV output")
  .option("--ytDlpPath <path>", "Explicit yt-dlp.exe path override")
  .option(
    "--assemblyAiCreditsCheck <mode>",
    "AssemblyAI credits check: warn | abort | none"
  )
  .option(
    "--assemblyAiMinBalanceMinutes <n>",
    "Warn/abort if remaining credits below N minutes",
    (v) => Number(v)
  )
  .option("--comments", "Fetch video comments via yt-dlp")
  .option(
    "--commentsMax <n>",
    "Limit comments per video when fetching",
    (v) => Number(v)
  )
  .option("--json-events", "Emit JSONL pipeline events to stdout")
  .option("--force", "Reprocess even if outputs exist")
  .parse(process.argv);

type CliOptions = ReturnType<typeof program.opts>;

function assertSafePathInput(value: string, label: string): void {
  if (/[\0\r\n]/.test(value)) {
    throw new Error(`${label} contains invalid characters`);
  }
}

async function resolveFilePath(value: string, label: string): Promise<string> {
  assertSafePathInput(value, label);
  const resolved = pathResolve(value);
  const stat = await fs.stat(resolved).catch(() => undefined);
  if (!stat || !stat.isFile()) {
    throw new Error(`${label} must be an existing file`);
  }
  return resolved;
}

async function resolveDirPath(value: string, label: string): Promise<string> {
  assertSafePathInput(value, label);
  const resolved = pathResolve(value);
  const stat = await fs.stat(resolved).catch(() => undefined);
  if (stat && !stat.isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
  return resolved;
}

function allowAnyUrl(): boolean {
  const raw = (process.env.Y2T_RUN_ALLOW_ANY_URL ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function parseOptionalBool(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") {
    throw new Error(`${label} must be true or false`);
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  throw new Error(`${label} must be true or false`);
}

async function main() {
  const inputUrl = program.args[0] as string | undefined;
  const baseConfig = loadConfig();
  const opts = program.opts<CliOptions>();
  const emitter = opts.jsonEvents ? new JsonLinesEventEmitter() : undefined;
  if (opts.jsonEvents) process.env.Y2T_JSON_EVENTS = "1";

  if (opts.audio) {
    const audioPath = await resolveFilePath(opts.audio, "--audio");
    const config = {
      ...baseConfig,
      outputDir: opts.outDir ? await resolveDirPath(opts.outDir, "--outDir") : baseConfig.outputDir,
      audioDir: opts.audioDir ? await resolveDirPath(opts.audioDir, "--audioDir") : baseConfig.audioDir,
      filenameStyle:
        (opts.filenameStyle as
          | "id"
          | "id_title"
          | "title_id") ?? baseConfig.filenameStyle,
      audioFormat:
        (opts.audioFormat as "mp3" | "wav") ?? baseConfig.audioFormat,
      sttProvider:
        (opts.sttProvider as "assemblyai" | "deepgram" | "openai_whisper") ??
        baseConfig.sttProvider,
      deepgramModel: opts.deepgramModel ?? baseConfig.deepgramModel,
      deepgramDiarization:
        parseOptionalBool(opts.deepgramDiarization, "--deepgramDiarization") ??
        baseConfig.deepgramDiarization,
      openaiWhisperModel: opts.openaiWhisperModel ?? baseConfig.openaiWhisperModel,
      maxAudioMB: opts.maxAudioMB ?? baseConfig.maxAudioMB,
      splitOverlapSeconds: opts.splitOverlapSeconds ?? baseConfig.splitOverlapSeconds,
      languageDetection:
        (opts.languageDetection as "auto" | "manual") ??
        (opts.language ? "manual" : baseConfig.languageDetection),
      languageCode: opts.language ?? baseConfig.languageCode,
      concurrency: opts.concurrency ?? baseConfig.concurrency,
      maxNewVideos: opts.maxNewVideos ?? baseConfig.maxNewVideos,
      afterDate: opts.after ?? baseConfig.afterDate,
      csvEnabled: opts.csv ?? baseConfig.csvEnabled,
      ytDlpPath: opts.ytDlpPath ?? baseConfig.ytDlpPath,
      assemblyAiCreditsCheck:
        (opts.assemblyAiCreditsCheck as
          | "warn"
          | "abort"
          | "none") ?? baseConfig.assemblyAiCreditsCheck,
      assemblyAiMinBalanceMinutes:
        opts.assemblyAiMinBalanceMinutes ??
        baseConfig.assemblyAiMinBalanceMinutes,
      commentsEnabled: opts.comments ?? baseConfig.commentsEnabled,
      commentsMax: opts.commentsMax ?? baseConfig.commentsMax,
    };

    const audioId = `local-${randomUUID()}`;
    const originalFilename = pathBasename(audioPath);
    const title =
      opts.audioTitle ??
      pathBasename(audioPath, extname(audioPath)) ??
      originalFilename;

    await runPipeline(
      {
        kind: "audio",
        audioId,
        audioPath,
        title,
        originalFilename,
      },
      config,
      {
        force: Boolean(opts.force),
        emitter,
      }
    );
    return;
  }

  if (inputUrl) {
    if (!allowAnyUrl()) {
      const { kind } = classifyYoutubeUrl(inputUrl);
      if (kind === "unknown") {
        throw new Error(
          "Only YouTube URLs are supported (set Y2T_RUN_ALLOW_ANY_URL=true to override)."
        );
      }
    }
    const config = {
      ...baseConfig,
      outputDir: opts.outDir ? await resolveDirPath(opts.outDir, "--outDir") : baseConfig.outputDir,
      audioDir: opts.audioDir ? await resolveDirPath(opts.audioDir, "--audioDir") : baseConfig.audioDir,
      filenameStyle:
        (opts.filenameStyle as
          | "id"
          | "id_title"
          | "title_id") ?? baseConfig.filenameStyle,
      audioFormat:
        (opts.audioFormat as "mp3" | "wav") ?? baseConfig.audioFormat,
      sttProvider:
        (opts.sttProvider as "assemblyai" | "deepgram" | "openai_whisper") ??
        baseConfig.sttProvider,
      deepgramModel: opts.deepgramModel ?? baseConfig.deepgramModel,
      deepgramDiarization:
        parseOptionalBool(opts.deepgramDiarization, "--deepgramDiarization") ??
        baseConfig.deepgramDiarization,
      openaiWhisperModel: opts.openaiWhisperModel ?? baseConfig.openaiWhisperModel,
      maxAudioMB: opts.maxAudioMB ?? baseConfig.maxAudioMB,
      splitOverlapSeconds: opts.splitOverlapSeconds ?? baseConfig.splitOverlapSeconds,
      languageDetection:
        (opts.languageDetection as "auto" | "manual") ??
        (opts.language ? "manual" : baseConfig.languageDetection),
      languageCode: opts.language ?? baseConfig.languageCode,
      concurrency: opts.concurrency ?? baseConfig.concurrency,
      maxNewVideos: opts.maxNewVideos ?? baseConfig.maxNewVideos,
      afterDate: opts.after ?? baseConfig.afterDate,
      csvEnabled: opts.csv ?? baseConfig.csvEnabled,
      ytDlpPath: opts.ytDlpPath ?? baseConfig.ytDlpPath,
      assemblyAiCreditsCheck:
        (opts.assemblyAiCreditsCheck as
          | "warn"
          | "abort"
          | "none") ?? baseConfig.assemblyAiCreditsCheck,
      assemblyAiMinBalanceMinutes:
        opts.assemblyAiMinBalanceMinutes ??
        baseConfig.assemblyAiMinBalanceMinutes,
      commentsEnabled: opts.comments ?? baseConfig.commentsEnabled,
      commentsMax: opts.commentsMax ?? baseConfig.commentsMax,
    };

    await runPipeline(inputUrl, config, {
      force: Boolean(opts.force),
      emitter,
    });
    return;
  }

  const runs = loadRunsFile();
  if (!runs) {
    program.help({ error: true });
    return;
  }

  for (const run of runs) {
    const config = {
      ...baseConfig,
      outputDir: run.outDir ? await resolveDirPath(run.outDir, "runs.outDir") : baseConfig.outputDir,
      audioDir: run.audioDir ? await resolveDirPath(run.audioDir, "runs.audioDir") : baseConfig.audioDir,
      filenameStyle: run.filenameStyle ?? baseConfig.filenameStyle,
      audioFormat: run.audioFormat ?? baseConfig.audioFormat,
      sttProvider: run.sttProvider ?? baseConfig.sttProvider,
      deepgramModel: run.deepgramModel ?? baseConfig.deepgramModel,
      deepgramDiarization: run.deepgramDiarization ?? baseConfig.deepgramDiarization,
      openaiWhisperModel: run.openaiWhisperModel ?? baseConfig.openaiWhisperModel,
      maxAudioMB: run.maxAudioMB ?? baseConfig.maxAudioMB,
      splitOverlapSeconds: run.splitOverlapSeconds ?? baseConfig.splitOverlapSeconds,
      languageDetection:
        run.languageDetection ?? baseConfig.languageDetection,
      languageCode: run.languageCode ?? baseConfig.languageCode,
      concurrency: run.concurrency ?? baseConfig.concurrency,
      maxNewVideos: run.maxNewVideos ?? baseConfig.maxNewVideos,
      afterDate: run.after ?? baseConfig.afterDate,
      csvEnabled: run.csvEnabled ?? baseConfig.csvEnabled,
      ytDlpPath: run.ytDlpPath ?? baseConfig.ytDlpPath,
      assemblyAiCreditsCheck:
        run.assemblyAiCreditsCheck ?? baseConfig.assemblyAiCreditsCheck,
      assemblyAiMinBalanceMinutes:
        run.assemblyAiMinBalanceMinutes ??
        baseConfig.assemblyAiMinBalanceMinutes,
      commentsEnabled: run.commentsEnabled ?? baseConfig.commentsEnabled,
      commentsMax: run.commentsMax ?? baseConfig.commentsMax,
    };

    if (run.audioPath) {
      const audioPath = await resolveFilePath(run.audioPath, "runs.audioPath");
      const audioId = `local-${randomUUID()}`;
      const originalFilename = pathBasename(audioPath);
      const title =
        run.audioTitle ??
        pathBasename(audioPath, extname(audioPath)) ??
        originalFilename;
      await runPipeline(
        {
          kind: "audio",
          audioId,
          audioPath,
          title,
          originalFilename,
        },
        config,
        {
          force: Boolean(run.force),
          emitter,
        }
      );
      continue;
    }

    if (!run.url) {
      throw new Error("runs.yaml entry must include url or audioPath");
    }

    if (!allowAnyUrl()) {
      const { kind } = classifyYoutubeUrl(run.url);
      if (kind === "unknown") {
        throw new Error(
          "runs.yaml entry must be a YouTube URL (set Y2T_RUN_ALLOW_ANY_URL=true to override)"
        );
      }
    }
    await runPipeline(run.url, config, {
      force: Boolean(run.force),
      emitter,
    });
  }
}

main().catch((error) => {
  logError(
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  process.exit(1);
});

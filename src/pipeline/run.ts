import pLimit from "p-limit";
import {
  enumerateVideos,
  downloadAudio,
  fetchVideoDescription,
  fetchVideoComments,
  detectLanguageCode,
  safeChannelThumbnailUrl,
  fetchVideoMetadata,
  fetchChannelMetadata,
} from "../youtube/index.js";
import type { YoutubeListing } from "../youtube/index.js";
import { getListingWithCatalogCache } from "../youtube/catalogCache.js";
import { createTranscriptionProvider } from "../transcription/index.js";
import { formatTxt, formatCsv, formatMd, formatJsonl } from "../formatters/index.js";
import {
  getOutputPaths,
  isProcessed,
  saveTranscriptCsv,
  saveTranscriptJson,
  saveTranscriptTxt,
  saveTranscriptMd,
  saveTranscriptJsonl,
  saveVideoCommentsJson,
  saveVideoMetaJson,
  saveChannelMetaJson,
} from "../storage/index.js";
import { logErrorRecord } from "../storage/errors.js";
import { logInfo, logWarn, logStep } from "../utils/logger.js";
import { AppConfig } from "../config/schema.js";
import { validateYtDlpInstalled } from "../utils/deps.js";
import { InsufficientCreditsError } from "../transcription/errors.js";
import { PipelineEventEmitter, PipelineStage } from "./events.js";
import { YtDlpError } from "../youtube/ytDlpErrors.js";
import { splitAudioByLimit } from "../utils/audio.js";
import { mergeChunkTranscripts } from "../transcription/merge.js";
import { promises as fs } from "node:fs";
import { dirname, basename as pathBasename, extname } from "node:path";
import { makeChannelDirName } from "../storage/naming.js";
import { selectCandidateVideos } from "./plan.js";

type AssemblyAiAccountResponse = Record<string, unknown> & {
  credit_balance?: number;
  audio_minutes_remaining?: number;
  minutes_remaining?: number;
  audio_seconds_remaining?: number;
};

export type AudioRunInput = {
  kind: "audio";
  audioId: string;
  audioPath: string;
  title?: string;
  originalFilename?: string;
};

export type RunInput = string | AudioRunInput;

async function isAudioTooLarge(path: string, maxBytes: number): Promise<boolean> {
  const stats = await fs.stat(path);
  return stats.size > maxBytes;
}

async function ensureAudioPath(sourcePath: string, destPath: string): Promise<string> {
  if (sourcePath === destPath) return destPath;
  await fs.mkdir(dirname(destPath), { recursive: true });
  await fs.copyFile(sourcePath, destPath);
  return destPath;
}

function getCreditsMinutesRemaining(
  account: AssemblyAiAccountResponse
): number | undefined {
  if (typeof account.audio_minutes_remaining === "number") {
    return account.audio_minutes_remaining;
  }
  if (typeof account.minutes_remaining === "number") {
    return account.minutes_remaining;
  }
  if (typeof account.audio_seconds_remaining === "number") {
    return account.audio_seconds_remaining / 60;
  }
  if (typeof account.credit_balance === "number") {
    return account.credit_balance;
  }
  return undefined;
}

export async function runPipeline(
  input: RunInput,
  config: AppConfig,
  options: { force: boolean; emitter?: PipelineEventEmitter; abortSignal?: AbortSignal }
) {
  const isAudioInput = typeof input !== "string";
  const audioInput = isAudioInput ? input : undefined;
  const inputUrl = isAudioInput ? `audio:${input.audioId}` : input;
  const ytDlpCommand = audioInput
    ? undefined
    : await validateYtDlpInstalled(config.ytDlpPath);
  let stopAll = false;
  let cancelRequested = false;
  const emitter = options.emitter;
  const abortSignal = options.abortSignal;
  const nowIso = () => new Date().toISOString();
  const emitStage = (
    stage: PipelineStage,
    videoId: string,
    index: number,
    total: number
  ) => {
    emitter?.emit({
      type: "video:stage",
      videoId,
      stage,
      index,
      total,
      timestamp: nowIso(),
    });
  };

  const isCancelled = () => cancelRequested || abortSignal?.aborted === true;
  if (abortSignal?.aborted) cancelRequested = true;
  abortSignal?.addEventListener(
    "abort",
    () => {
      cancelRequested = true;
    },
    { once: true }
  );
  if (config.assemblyAiCreditsCheck !== "none" && config.sttProvider === "assemblyai") {
    try {
      const provider = createTranscriptionProvider(config);
      if (!provider.getAccount) {
        logWarn("STT provider does not support credits check; continuing.");
      } else {
        const account = (await provider.getAccount()) as AssemblyAiAccountResponse;
        const minutesRemaining = getCreditsMinutesRemaining(account);
        if (minutesRemaining !== undefined) {
          logStep(
            "credits",
            `AssemblyAI balance: ~${minutesRemaining.toFixed(
              1
            )} minutes remaining`
          );
          if (
            minutesRemaining < config.assemblyAiMinBalanceMinutes &&
            config.assemblyAiCreditsCheck === "abort"
          ) {
            throw new Error(
              `AssemblyAI credits below threshold (${config.assemblyAiMinBalanceMinutes} min). Aborting run.`
            );
          }
          if (
            minutesRemaining < config.assemblyAiMinBalanceMinutes &&
            config.assemblyAiCreditsCheck === "warn"
          ) {
            logWarn(
              `Low AssemblyAI credits: ~${minutesRemaining.toFixed(
                1
              )} min remaining (< ${config.assemblyAiMinBalanceMinutes} min)`
            );
          }
        } else {
          logWarn(
            "AssemblyAI account balance unavailable; continuing without credits check."
          );
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      logWarn(
        `AssemblyAI credits check failed (${message}); continuing.`
      );
    }
  }

  const ytDlpExtraArgs: string[] = [];
  const listing: YoutubeListing = audioInput
    ? {
        channelId: "uploads",
        channelTitle: "Uploads",
        videos: [
          {
            id: audioInput.audioId,
            title:
              audioInput.title ??
              pathBasename(audioInput.audioPath, extname(audioInput.audioPath)) ??
              "upload",
            url: inputUrl,
            uploadDate: new Date().toISOString().slice(0, 10),
          },
        ],
      }
    : await getListingWithCatalogCache(
        inputUrl,
        config.outputDir,
        {
          ytDlpCommand: ytDlpCommand!,
          ytDlpExtraArgs,
        },
        {
          maxAgeHours: config.catalogMaxAgeHours,
        }
      );
  const audioExt = audioInput
    ? (() => {
        const raw = extname(audioInput.audioPath);
        return raw ? raw.slice(1).toLowerCase() : config.audioFormat;
      })()
    : undefined;
  const channelDirNameOverride = audioInput ? "uploads" : undefined;
  const channelDirName =
    channelDirNameOverride ??
    makeChannelDirName(listing.channelId, listing.channelTitle);

  const selection = await selectCandidateVideos(listing, config, { force: options.force });
  const candidateTotal = selection.totalVideos;
  const candidateAlreadyProcessed = selection.alreadyProcessed;
  const candidateUnprocessed = selection.unprocessed;
  const selectedCandidates = selection.selectedCandidates;

  const videoJobs = selectedCandidates.map(({ video, basename }, index) => ({
    video,
    basename,
    index: index + 1,
    paths: getOutputPaths(
      listing.channelId,
      listing.channelTitle,
      video.id,
      video.title,
      {
        outputDir: config.outputDir,
        audioDir: config.audioDir,
        audioFormat: config.audioFormat,
      },
      {
        filenameStyle: config.filenameStyle,
        channelDirName: channelDirNameOverride,
        audioExt,
      }
    ),
  }));

  const totalVideos = videoJobs.length;
  let completedVideos = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  logStep(
    "progress",
    `Channel ${listing.channelId}: ${candidateAlreadyProcessed}/${candidateTotal} already processed (${candidateUnprocessed} unprocessed); selected ${totalVideos} to process`
  );

  emitter?.emit({
    type: "run:start",
    inputUrl,
    channelId: listing.channelId,
    channelTitle: listing.channelTitle,
    channelDirName,
    totalVideos,
    alreadyProcessed: 0,
    remaining: totalVideos,
    channelTotalVideos: candidateTotal,
    channelAlreadyProcessed: candidateAlreadyProcessed,
    channelUnprocessed: candidateUnprocessed,
    timestamp: nowIso(),
  });

  if (totalVideos > 0) {
    const channelMetaPath = videoJobs[0]?.paths.channelMetaPath;
    if (channelMetaPath) {
      let channelThumbnailUrl: string | undefined;
      let channelUrl: string | undefined;

      if (!audioInput) {
        channelUrl = `https://www.youtube.com/channel/${listing.channelId}`;
        const channelMeta =
          (await fetchChannelMetadata(channelUrl, ytDlpCommand!, ytDlpExtraArgs)) ??
          undefined;
        channelThumbnailUrl = safeChannelThumbnailUrl(channelMeta);

        if (!channelThumbnailUrl) {
          const firstVideoUrl = selectedCandidates[0]?.video.url;
          if (firstVideoUrl) {
            const videoMeta = await fetchVideoMetadata(
              firstVideoUrl,
              ytDlpCommand!,
              ytDlpExtraArgs
            );
            const uploaderUrl = [videoMeta?.uploader_url, videoMeta?.channel_url].find(
              (value) => typeof value === "string" && value.trim().length > 0
            );
            if (uploaderUrl) {
              const chanMeta = await fetchChannelMetadata(
                uploaderUrl,
                ytDlpCommand!,
                ytDlpExtraArgs
              );
              channelThumbnailUrl = safeChannelThumbnailUrl(chanMeta);
            }
          }
        }
      }

      await saveChannelMetaJson(channelMetaPath, {
        channelId: listing.channelId,
        channelTitle: listing.channelTitle,
        channelThumbnailUrl,
        channelUrl,
        inputUrl,
        updatedAt: nowIso(),
      });
    }
  }

  const provider = createTranscriptionProvider(config);
  const limit = pLimit(config.concurrency);
  const providerCaps = provider.getCapabilities();
  const providerMaxBytes = providerCaps.maxAudioBytes;
  const userMaxBytes =
    typeof config.maxAudioMB === "number" ? config.maxAudioMB * 1024 * 1024 : undefined;
  const effectiveMaxBytes =
    userMaxBytes !== undefined && providerMaxBytes !== undefined
      ? Math.min(userMaxBytes, providerMaxBytes)
      : userMaxBytes ?? providerMaxBytes;
  const splitOverlapSeconds =
    typeof config.splitOverlapSeconds === "number"
      ? config.splitOverlapSeconds
      : 2;

  try {
    await Promise.all(
      videoJobs.map(({ video, basename: videoBasename, paths, index }) =>
        limit(async () => {
          let stageForError: PipelineStage = "download";
          let hintForError: string | undefined;
          const markSkip = (reason: string) => {
            completedVideos += 1;
            skipped += 1;
            const remaining = totalVideos - completedVideos;
            logStep(
              "skip",
              `Video ${index}/${totalVideos} ${reason}: ${completedVideos}/${totalVideos} videos completed (${remaining} remaining)`
            );
            emitter?.emit({
              type: "video:skip",
              videoId: video.id,
              basename: videoBasename,
              reason,
              index,
              total: totalVideos,
              completed: completedVideos,
              remaining,
              timestamp: nowIso(),
            });
          };

          if (isCancelled()) {
            markSkip("cancelled");
            stopAll = true;
            return;
          }
          if (stopAll) {
            markSkip("stopped");
            return;
          }

          const markFinished = (
            label: "done" | "failed",
            errorMessage?: string
          ) => {
            completedVideos += 1;
            if (label === "done") succeeded += 1;
            if (label === "failed") failed += 1;
            const remaining = totalVideos - completedVideos;
            logStep(
              "progress",
              `Video ${index}/${totalVideos} ${label}: ${completedVideos}/${totalVideos} videos completed (${remaining} remaining)`
            );
            if (label === "done") {
              emitter?.emit({
                type: "video:done",
                videoId: video.id,
                basename: videoBasename,
                index,
                total: totalVideos,
                completed: completedVideos,
                remaining,
                timestamp: nowIso(),
              });
            }
            if (label === "failed") {
              emitter?.emit({
                type: "video:error",
                videoId: video.id,
                basename: videoBasename,
                error: errorMessage ?? "Unknown error",
                stage: stageForError,
                index,
                total: totalVideos,
                completed: completedVideos,
                remaining,
                timestamp: nowIso(),
              });
            }
          };

          try {
            emitter?.emit({
              type: "video:start",
              videoId: video.id,
              title: video.title,
              url: video.url,
              index,
              total: totalVideos,
              timestamp: nowIso(),
            });

            stageForError = "download";
            emitStage("download", video.id, index, totalVideos);
            const audioPath = audioInput
              ? await ensureAudioPath(audioInput.audioPath, paths.audioPath)
              : await downloadAudio(
                  video.url,
                  paths.audioPath,
                  config.audioFormat,
                  config.downloadRetries,
                  ytDlpCommand!,
                  ytDlpExtraArgs
                );
            if (isCancelled()) {
              markSkip("cancelled");
              stopAll = true;
              return;
            }

            const language =
              config.languageDetection === "manual"
                ? {
                    languageCode: config.languageCode,
                    detected: true,
                    source: "manual" as const,
                  }
                : audioInput
                  ? {
                      languageCode: config.languageCode,
                      detected: false,
                      source: "none" as const,
                    }
                  : await detectLanguageCode(
                      video.url,
                      ytDlpCommand!,
                      ytDlpExtraArgs,
                      config.languageCode
                    );

            const useProviderAutoLanguageDetection =
              config.languageDetection !== "manual" && !language.detected;

            if (useProviderAutoLanguageDetection) {
              logStep(
                "language",
                "Undetected via yt-dlp; using provider automatic language detection"
              );
            }

            stageForError = "transcribe";
            emitStage("transcribe", video.id, index, totalVideos);
            let transcript;
            if (effectiveMaxBytes && (await isAudioTooLarge(audioPath, effectiveMaxBytes))) {
              stageForError = "split";
              emitStage("split", video.id, index, totalVideos);
              logStep(
                "split",
                `Audio exceeds ${Math.round(effectiveMaxBytes / (1024 * 1024))}MB; splitting`
              );
              const { chunks, cleanup } = await splitAudioByLimit(
                audioPath,
                effectiveMaxBytes,
                splitOverlapSeconds
              );
              try {
                const chunkResults = [];
                for (const chunk of chunks) {
                  stageForError = "transcribe";
                  const chunkTranscript = await provider.transcribe(chunk.path, {
                    languageCode: useProviderAutoLanguageDetection ? undefined : language.languageCode,
                    languageDetection: useProviderAutoLanguageDetection ? true : undefined,
                    pollIntervalMs: config.pollIntervalMs,
                    maxPollMinutes: config.maxPollMinutes,
                    retries: config.transcriptionRetries,
                    providerTimeoutMs: config.providerTimeoutMs,
                  });
                  chunkResults.push({
                    transcript: chunkTranscript,
                    startSeconds: chunk.startSeconds,
                    overlapSeconds: chunk.overlapSeconds,
                  });
                }
                transcript = mergeChunkTranscripts(chunkResults);
              } finally {
                await cleanup();
              }
            } else {
              transcript = await provider.transcribe(audioPath, {
                languageCode: useProviderAutoLanguageDetection ? undefined : language.languageCode,
                languageDetection: useProviderAutoLanguageDetection ? true : undefined,
                pollIntervalMs: config.pollIntervalMs,
                maxPollMinutes: config.maxPollMinutes,
                retries: config.transcriptionRetries,
                providerTimeoutMs: config.providerTimeoutMs,
              });
            }

            const description = audioInput
              ? video.description
              : video.description ??
                (await fetchVideoDescription(video.url, ytDlpCommand!, ytDlpExtraArgs));

            if (config.commentsEnabled && !audioInput) {
              try {
                if (
                  options.force ||
                  !(await isProcessed(paths.commentsPath))
                ) {
                  stageForError = "comments";
                  emitStage("comments", video.id, index, totalVideos);
                  const comments = await fetchVideoComments(
                    video.url,
                    ytDlpCommand,
                    config.commentsMax,
                    ytDlpExtraArgs
                  );
                  if (comments) {
                    await saveVideoCommentsJson(
                      paths.commentsPath,
                      comments
                    );
                  }
                }
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : String(error);
                logWarn(
                  `Comments fetch failed for ${video.id}: ${message}`
                );
              }
            }

            stageForError = "save";
            emitStage("save", video.id, index, totalVideos);
            await saveTranscriptJson(paths.jsonPath, transcript);
            await saveVideoMetaJson(paths.metaPath, {
              videoId: video.id,
              title: video.title,
              url: video.url,
              uploadDate: video.uploadDate,
              description,
              channelId: listing.channelId,
              channelTitle: listing.channelTitle,
              source: audioInput ? "upload" : "youtube",
              audioId: audioInput ? audioInput.audioId : undefined,
              originalFilename: audioInput ? audioInput.originalFilename : undefined,
              filenameStyle: config.filenameStyle,
              audioFormat: audioInput && audioExt ? audioExt : config.audioFormat,
              languageCode:
                typeof transcript.language_code === "string"
                  ? transcript.language_code
                  : useProviderAutoLanguageDetection
                    ? undefined
                    : language.languageCode,
              languageDetection: useProviderAutoLanguageDetection ? true : undefined,
              languageConfidence:
                typeof transcript.language_confidence === "number"
                  ? transcript.language_confidence
                  : undefined,
              createdAt: nowIso(),
            });
            const finalLanguageCode =
              typeof transcript.language_code === "string"
                ? transcript.language_code
                : language.languageCode;
            const finalLanguageConfidence =
              typeof transcript.language_confidence === "number"
                ? transcript.language_confidence
                : undefined;

            await saveTranscriptTxt(
              paths.txtPath,
              formatTxt(transcript, {
                channelId: listing.channelId,
                channelTitle: listing.channelTitle,
                title: video.title,
                url: video.url,
                uploadDate: video.uploadDate,
                description,
                languageCode: finalLanguageCode,
                languageSource: useProviderAutoLanguageDetection ? "auto-detected" : "yt-dlp",
                languageConfidence: finalLanguageConfidence,
              })
            );

            await saveTranscriptMd(
              paths.mdPath,
              formatMd(transcript, {
                channelId: listing.channelId,
                channelTitle: listing.channelTitle,
                title: video.title,
                url: video.url,
                uploadDate: video.uploadDate,
                description,
                languageCode: finalLanguageCode,
                languageSource: useProviderAutoLanguageDetection ? "auto-detected" : "yt-dlp",
                languageConfidence: finalLanguageConfidence,
              })
            );

            await saveTranscriptJsonl(
              paths.jsonlPath,
              formatJsonl(transcript, {
                videoId: video.id,
                url: video.url,
                title: video.title,
                channelId: listing.channelId,
                channelTitle: listing.channelTitle,
                languageCode: finalLanguageCode,
                languageConfidence: finalLanguageConfidence,
              })
            );

            stageForError = "format";
            emitStage("format", video.id, index, totalVideos);
            if (config.csvEnabled) {
              await saveTranscriptCsv(
                paths.csvPath,
                formatCsv(transcript)
              );
            }

            logStep("done", `Video ${index}/${totalVideos} done: ${video.id}`);
            markFinished("done");
          } catch (error) {
            if (error instanceof InsufficientCreditsError) {
              stopAll = true;
              logWarn(
                `Stopping run: AssemblyAI credits exhausted while processing Video ${index}/${totalVideos} (${video.id})`
              );
              throw error;
            }
            if (error instanceof YtDlpError) {
              hintForError = error.info.hint;
            }
            const message =
              error instanceof Error ? error.message : String(error);
            logWarn(
              `Failed Video ${index}/${totalVideos} (${video.id}) [${stageForError}]: ${message}`
            );
            if (hintForError) {
              logWarn(hintForError);
            }
            await logErrorRecord(paths.errorLogPath, {
              videoId: video.id,
              videoUrl: video.url,
              stage: stageForError,
              message: hintForError ? `${message}\nHint: ${hintForError}` : message,
              timestamp: new Date().toISOString(),
            });
            markFinished("failed", message);
          }
        })
      )
    );

    if (isCancelled()) {
      emitter?.emit({
        type: "run:cancelled",
        channelId: listing.channelId,
        total: totalVideos,
        succeeded,
        failed,
        skipped,
        timestamp: nowIso(),
      });
    } else {
      emitter?.emit({
        type: "run:done",
        channelId: listing.channelId,
        total: totalVideos,
        succeeded,
        failed,
        skipped,
        timestamp: nowIso(),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitter?.emit({
      type: "run:error",
      channelId: listing.channelId,
      error: message,
      timestamp: nowIso(),
    });
    throw error;
  }
}

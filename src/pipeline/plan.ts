import type { YoutubeListing, YoutubeVideo } from "../youtube/types.js";
import type { AppConfig } from "../config/schema.js";
import { isAfterDate, isBeforeDate } from "../utils/date.js";
import { validateYtDlpInstalled } from "../utils/deps.js";
import { makeVideoBaseName } from "../storage/naming.js";
import { buildProcessedVideoIdSet } from "../storage/processedIndex.js";
import { getListingWithCatalogCache } from "../youtube/catalogCache.js";
import { UsageLedger } from "../usage/index.js";
import type { UsageEstimate } from "../usage/index.js";

export type PlannedVideo = {
  id: string;
  title: string;
  url: string;
  uploadDate?: string;
  durationSeconds?: number;
  basename: string;
  processed: boolean;
};

export type RunPlan = {
  inputUrl: string;
  force: boolean;
  channelId: string;
  channelTitle?: string;
  totalVideos: number;
  alreadyProcessed: number;
  unprocessed: number;
  toProcess: number;
  filters: {
    afterDate?: string;
    beforeDate?: string;
    maxNewVideos?: number;
    videoIds?: string[];
  };
  videos: PlannedVideo[];
  selectedVideos: PlannedVideo[];
  usageEstimate?: UsageEstimate;
};

type BuildProcessedSetFn = (outputDir: string, channelId: string) => Promise<Set<string>>;

export type CandidateVideo = {
  video: YoutubeVideo;
  basename: string;
  processed: boolean;
};

export type CandidateVideoSelection = {
  candidates: CandidateVideo[];
  selectedCandidates: CandidateVideo[];
  totalVideos: number;
  alreadyProcessed: number;
  unprocessed: number;
  filters: RunPlan["filters"];
};

export async function selectCandidateVideos(
  listing: YoutubeListing,
  config: AppConfig,
  options: { force: boolean },
  deps?: { buildProcessedVideoIdSet?: BuildProcessedSetFn }
): Promise<CandidateVideoSelection> {
  const videoIdSet = config.videoIds ? new Set(config.videoIds) : undefined;

  // When videoIds is provided, filter to only those IDs (ignoring date filters).
  // Otherwise, apply date-range filters as before.
  const filteredVideos = videoIdSet
    ? listing.videos.filter((v) => videoIdSet.has(v.id))
    : listing.videos.filter((v) =>
        isAfterDate(v.uploadDate, config.afterDate) && isBeforeDate(v.uploadDate, config.beforeDate)
      );

  // When videoIds is provided, Cortex is the source of truth for what's processed.
  // Skip processedIndex entirely — all matched videos are considered unprocessed.
  const skipProcessedCheck = Boolean(videoIdSet);

  // Fast "processed" detection: scan existing outputs once per channelId rather than
  // doing a filesystem existence check for every video in the channel listing.
  const buildFn = deps?.buildProcessedVideoIdSet ?? buildProcessedVideoIdSet;
  const processedSet =
    options.force || skipProcessedCheck
      ? new Set<string>()
      : await buildFn(config.outputDir, listing.channelId);

  const candidates: CandidateVideo[] = filteredVideos.map((video) => ({
    video,
    basename: makeVideoBaseName(video.id, video.title, config.filenameStyle),
    processed: options.force || skipProcessedCheck ? false : processedSet.has(video.id),
  }));

  const alreadyProcessed = candidates.filter((v) => v.processed).length;
  const totalVideos = candidates.length;
  const unprocessed = totalVideos - alreadyProcessed;

  const maxNewVideos = config.maxNewVideos;
  const selectedCandidates =
    options.force || skipProcessedCheck
      ? candidates.slice(0, maxNewVideos ?? candidates.length).map((v) => ({ ...v, processed: false }))
      : candidates
          .filter((v) => !v.processed)
          .slice(0, maxNewVideos ?? candidates.length);

  return {
    candidates,
    selectedCandidates,
    totalVideos,
    alreadyProcessed,
    unprocessed,
    filters: {
      afterDate: videoIdSet ? undefined : config.afterDate,
      beforeDate: videoIdSet ? undefined : config.beforeDate,
      maxNewVideos: config.maxNewVideos,
      videoIds: config.videoIds,
    },
  };
}

export async function planFromListing(
  inputUrl: string,
  listing: YoutubeListing,
  config: AppConfig,
  options: { force: boolean },
  deps?: { buildProcessedVideoIdSet?: BuildProcessedSetFn }
): Promise<RunPlan> {
  const selection = await selectCandidateVideos(listing, config, options, deps);

  const toPlannedVideo = (candidate: CandidateVideo): PlannedVideo => ({
    id: candidate.video.id,
    title: candidate.video.title,
    url: candidate.video.url,
    uploadDate: candidate.video.uploadDate,
    durationSeconds: candidate.video.durationSeconds,
    basename: candidate.basename,
    processed: candidate.processed,
  });

  const videos = selection.candidates.map(toPlannedVideo);
  const selectedVideos = selection.selectedCandidates.map(toPlannedVideo);

  return {
    inputUrl,
    force: options.force,
    channelId: listing.channelId,
    channelTitle: listing.channelTitle,
    totalVideos: selection.totalVideos,
    alreadyProcessed: selection.alreadyProcessed,
    unprocessed: selection.unprocessed,
    toProcess: selectedVideos.length,
    filters: selection.filters,
    videos,
    selectedVideos,
  };
}

export async function planRun(
  inputUrl: string,
  config: AppConfig,
  options: { force: boolean }
): Promise<RunPlan> {
  const ytDlpCommand = await validateYtDlpInstalled(config.ytDlpPath);
  const ytDlpExtraArgs: string[] = [];
  const listing = await getListingWithCatalogCache(inputUrl, config.outputDir, {
    ytDlpCommand,
    ytDlpExtraArgs,
  }, {
    maxAgeHours: config.catalogMaxAgeHours,
  });
  const plan = await planFromListing(inputUrl, listing, config, options);
  const known = plan.selectedVideos.filter(
    (video) => typeof video.durationSeconds === "number" && video.durationSeconds > 0
  );
  const ledger = new UsageLedger(config.outputDir);
  plan.usageEstimate = await ledger.estimate(
    known.map((video) => ({
      runId: "plan-preview",
      sourceId: plan.channelId,
      itemId: video.id,
      provider: config.sttProvider,
      audioSeconds: video.durationSeconds!,
      itemSeconds: video.durationSeconds!,
    })),
    plan.selectedVideos.length - known.length,
    config.sttProvider
  );
  return plan;
}

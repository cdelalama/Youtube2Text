import { enumerateVideos } from "../youtube/enumerate.js";
import type { YoutubeListing } from "../youtube/types.js";
import type { AppConfig } from "../config/schema.js";
import { isAfterDate, isBeforeDate } from "../utils/date.js";
import { validateYtDlpInstalled } from "../utils/deps.js";
import { makeVideoBaseName } from "../storage/naming.js";
import { getOutputPaths } from "../storage/index.js";
import { buildProcessedVideoIdSet } from "../storage/processedIndex.js";
import { getListingWithCatalogCache } from "../youtube/catalogCache.js";

export type PlannedVideo = {
  id: string;
  title: string;
  url: string;
  uploadDate?: string;
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
};

type BuildProcessedSetFn = (outputDir: string, channelId: string) => Promise<Set<string>>;

export async function planFromListing(
  inputUrl: string,
  listing: YoutubeListing,
  config: AppConfig,
  options: { force: boolean },
  deps?: { buildProcessedVideoIdSet?: BuildProcessedSetFn }
): Promise<RunPlan> {
  const videoIdSet = config.videoIds ? new Set(config.videoIds) : undefined;

  // When videoIds is provided, filter to only those IDs (ignoring date filters).
  // Otherwise, apply date-range filters as before.
  const filteredVideos = videoIdSet
    ? listing.videos.filter((v) => videoIdSet.has(v.id))
    : listing.videos.filter((v) =>
        isAfterDate(v.uploadDate, config.afterDate) && isBeforeDate(v.uploadDate, config.beforeDate)
      );

  const planned = filteredVideos.map((video) => {
    const basename = makeVideoBaseName(video.id, video.title, config.filenameStyle);
    const paths = getOutputPaths(
      listing.channelId,
      listing.channelTitle,
      video.id,
      video.title,
      {
        outputDir: config.outputDir,
        audioDir: config.audioDir,
        audioFormat: config.audioFormat,
      },
      { filenameStyle: config.filenameStyle }
    );
    return { video, basename, jsonPath: paths.jsonPath };
  });

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

  const videos: PlannedVideo[] = planned.map((p) => ({
    id: p.video.id,
    title: p.video.title,
    url: p.video.url,
    uploadDate: p.video.uploadDate,
    basename: p.basename,
    processed: options.force || skipProcessedCheck ? false : processedSet.has(p.video.id),
  }));

  const alreadyProcessed = videos.filter((v) => v.processed).length;
  const totalVideos = videos.length;
  const unprocessed = totalVideos - alreadyProcessed;

  const maxNewVideos = config.maxNewVideos;
  const selectedVideos =
    options.force || skipProcessedCheck
      ? videos.slice(0, maxNewVideos ?? videos.length).map((v) => ({ ...v, processed: false }))
      : videos
          .filter((v) => !v.processed)
          .slice(0, maxNewVideos ?? videos.length);

  return {
    inputUrl,
    force: options.force,
    channelId: listing.channelId,
    channelTitle: listing.channelTitle,
    totalVideos,
    alreadyProcessed,
    unprocessed,
    toProcess: selectedVideos.length,
    filters: {
      afterDate: videoIdSet ? undefined : config.afterDate,
      beforeDate: videoIdSet ? undefined : config.beforeDate,
      maxNewVideos: config.maxNewVideos,
      videoIds: config.videoIds,
    },
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
  // Keep planning behavior aligned with run() for yt-dlp EJS/runtime handling.
  const ytDlpExtraArgs: string[] = ["--js-runtimes", "node,deno"];
  const listing = await getListingWithCatalogCache(inputUrl, config.outputDir, {
    ytDlpCommand,
    ytDlpExtraArgs,
  }, {
    maxAgeHours: config.catalogMaxAgeHours,
  });
  return planFromListing(inputUrl, listing, config, options);
}

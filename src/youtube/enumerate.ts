import { execCommand } from "../utils/exec.js";
import { logStep } from "../utils/logger.js";
import { YoutubeListing, YoutubeVideo } from "./types.js";
import { normalizeChannelUrlForEnumeration } from "./url.js";

type YtDlpEntry = {
  id?: string;
  title?: string;
  url?: string;
  webpage_url?: string;
  upload_date?: string;
  duration?: number;
};

type YtDlpListing = {
  id?: string;
  channel_id?: string;
  uploader_id?: string;
  title?: string;
  uploader?: string;
  webpage_url?: string;
  url?: string;
  upload_date?: string;
  duration?: number;
  entries?: YtDlpEntry[];
};

function inferChannelId(listing: YtDlpListing, inputUrl: string): string {
  return (
    listing.channel_id ||
    listing.uploader_id ||
    listing.id ||
    inputUrl.replace(/https?:\/\//, "").replace(/[^\w-]+/g, "_")
  );
}

export async function enumerateVideos(
  inputUrl: string,
  ytDlpCommand = "yt-dlp",
  ytDlpExtraArgs: string[] = [],
  options?: { playlistEnd?: number }
): Promise<YoutubeListing> {
  // Normalize channel URLs to include /videos suffix.
  // Without this, yt-dlp returns channel tabs (Videos, Shorts, etc.) instead of actual videos.
  const normalizedUrl = normalizeChannelUrlForEnumeration(inputUrl);
  logStep("enumerate", `Enumerating videos from ${normalizedUrl} ...`);
  const args = [
    ...ytDlpExtraArgs,
    "--flat-playlist",
    "--dump-single-json",
    ...(typeof options?.playlistEnd === "number" && options.playlistEnd > 0
      ? ["--playlist-end", String(Math.trunc(options.playlistEnd))]
      : []),
    normalizedUrl,
  ];
  const result = await execCommand(ytDlpCommand, args);
  if (result.exitCode !== 0) {
    throw new Error(`yt-dlp failed: ${result.stderr}`);
  }

  const listing = JSON.parse(result.stdout) as YtDlpListing;
  const channelId = inferChannelId(listing, inputUrl);
  const channelTitle = listing.uploader || listing.title;

  let videos: YoutubeVideo[] =
    listing.entries
      ?.filter((e) => e.id)
      .map((e) => ({
        id: e.id as string,
        title: e.title || e.id || "Untitled",
        url:
          e.webpage_url ||
          e.url ||
          `https://www.youtube.com/watch?v=${e.id}`,
        uploadDate: e.upload_date,
        durationSeconds:
          typeof e.duration === "number" && e.duration > 0 ? e.duration : undefined,
      })) ?? [];

  if (videos.length === 0 && listing.id) {
    videos = [
      {
        id: listing.id,
        title: listing.title || listing.id || "Untitled",
        url:
          listing.webpage_url ||
          listing.url ||
          inputUrl ||
          `https://www.youtube.com/watch?v=${listing.id}`,
        uploadDate: listing.upload_date,
        durationSeconds:
          typeof listing.duration === "number" && listing.duration > 0
            ? listing.duration
            : undefined,
      },
    ];
  }

  return { channelId, channelTitle, videos };
}

import { join } from "node:path";
import type { AppConfig } from "../config/schema.js";
import {
  fileExists,
  writeJson,
  writeText,
} from "../utils/fs.js";
import { TranscriptJson } from "../transcription/types.js";
import { makeChannelDirName, makeVideoBaseName } from "./naming.js";
export type { StorageAdapter, ChannelInfo, VideoInfo } from "./adapter.js";
export { FileSystemStorageAdapter } from "./fsAdapter.js";
export { makeChannelDirName, makeVideoBaseName } from "./naming.js";

export type OutputPaths = {
  jsonPath: string;
  txtPath: string;
  mdPath: string;
  jsonlPath: string;
  csvPath: string;
  commentsPath: string;
  metaPath: string;
  channelMetaPath: string;
  errorLogPath: string;
  audioPath: string;
};

export type ChannelMeta = {
  channelId: string;
  channelTitle?: string;
  channelThumbnailUrl?: string;
  channelUrl?: string;
  inputUrl?: string;
  updatedAt: string;
};

export type VideoMeta = {
  videoId: string;
  title: string;
  url: string;
  uploadDate?: string;
  description?: string;
  channelId: string;
  channelTitle?: string;
  source?: "youtube" | "upload";
  audioId?: string;
  originalFilename?: string;
  filenameStyle: AppConfig["filenameStyle"];
  audioFormat: string;
  languageCode?: string;
  languageDetection?: boolean;
  languageConfidence?: number;
  transcriptId?: string;
  transcriptRecordSha256?: string;
  transcriptSchemaVersion?: "media2text.transcript.v1";
  createdAt: string;
};

export function getChannelDirName(
  channelId: string,
  channelTitle?: string
): string {
  return makeChannelDirName(channelId, channelTitle);
}

export function getOutputPaths(
  channelId: string,
  channelTitle: string | undefined,
  videoId: string,
  videoTitle: string,
  dirs: { outputDir: string; audioDir: string; audioFormat: string },
  options?: { filenameStyle?: AppConfig["filenameStyle"]; channelDirName?: string; audioExt?: string }
): OutputPaths {
  const style = options?.filenameStyle ?? "title_id";
  const channelDirName =
    options?.channelDirName ?? makeChannelDirName(channelId, channelTitle);
  const baseName = makeVideoBaseName(videoId, videoTitle, style);
  const audioExt = options?.audioExt ?? dirs.audioFormat;
  return {
    jsonPath: join(dirs.outputDir, channelDirName, `${baseName}.json`),
    txtPath: join(dirs.outputDir, channelDirName, `${baseName}.txt`),
    mdPath: join(dirs.outputDir, channelDirName, `${baseName}.md`),
    jsonlPath: join(dirs.outputDir, channelDirName, `${baseName}.jsonl`),
    csvPath: join(dirs.outputDir, channelDirName, `${baseName}.csv`),
    commentsPath: join(
      dirs.outputDir,
      channelDirName,
      `${baseName}.comments.json`
    ),
    metaPath: join(dirs.outputDir, channelDirName, `${baseName}.meta.json`),
    channelMetaPath: join(dirs.outputDir, channelDirName, `_channel.json`),
    errorLogPath: join(dirs.outputDir, channelDirName, `_errors.jsonl`),
    audioPath: join(
      dirs.audioDir,
      channelDirName,
      `${baseName}.${audioExt}`
    ),
  };
}

export async function isProcessed(jsonPath: string): Promise<boolean> {
  return fileExists(jsonPath);
}

export async function saveTranscriptJson(
  path: string,
  transcript: TranscriptJson
) {
  await writeJson(path, transcript);
}

export async function saveTranscriptTxt(path: string, text: string) {
  await writeText(path, text);
}

export async function saveTranscriptMd(path: string, text: string) {
  await writeText(path, text);
}

export async function saveTranscriptJsonl(path: string, text: string) {
  await writeText(path, text);
}

export async function saveTranscriptCsv(path: string, csv: string) {
  await writeText(path, csv);
}

export async function saveVideoCommentsJson(path: string, comments: unknown[]) {
  await writeJson(path, { comments });
}

export async function saveVideoMetaJson(path: string, meta: VideoMeta) {
  await writeJson(path, meta);
}

export async function saveChannelMetaJson(path: string, meta: ChannelMeta) {
  await writeJson(path, meta);
}

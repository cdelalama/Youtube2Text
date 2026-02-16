import { TranscriptJson } from "../transcription/types.js";
import { OutputPaths, ChannelMeta, VideoMeta } from "./index.js";

export type ChannelInfo = {
  channelId: string;
  channelTitle?: string;
  channelDirName: string;
  channelThumbnailUrl?: string;
  metaPath?: string;
};

export type VideoInfo = {
  videoId: string;
  title?: string;
  basename: string;
  metaPath?: string;
  paths: OutputPaths;
  meta?: VideoMeta;
};

export type DeleteChannelResult = {
  outputFiles: number;
  audioRemoved: boolean;
  catalogCacheRemoved: boolean;
};

export type DeleteVideoResult = {
  outputFiles: number;
  audioFiles: number;
};

export interface StorageAdapter {
  listChannels(): Promise<ChannelInfo[]>;
  listVideos(channelDirName: string): Promise<VideoInfo[]>;

  readChannelMeta(channelDirName: string): Promise<ChannelMeta | undefined>;
  readVideoMeta(path: string): Promise<VideoMeta | undefined>;

  readTranscriptJson(path: string): Promise<TranscriptJson>;
  readText(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;

  getAudioPath(paths: OutputPaths): string;

  deleteChannel(channelDirName: string): Promise<DeleteChannelResult>;
  deleteVideo(channelDirName: string, basename: string): Promise<DeleteVideoResult>;
}

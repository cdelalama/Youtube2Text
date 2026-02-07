import Link from "next/link";
import { apiGetJson } from "../../../lib/api";
import type { ChannelMetaResponse, VideosResponse, VideoInfo } from "../../../lib/apiSchema";
import { ChannelActions } from "./ChannelActions";
import { VideoActions } from "./VideoActions";

function youtubeThumb(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export default async function ChannelPage({
  params,
}: {
  params: { channelDirName: string };
}) {
  const channelDirName = decodeURIComponent(params.channelDirName);
  const [videosData, metaData] = await Promise.all([
    apiGetJson<VideosResponse>(`/library/channels/${encodeURIComponent(channelDirName)}/videos`),
    apiGetJson<ChannelMetaResponse>(`/library/channels/${encodeURIComponent(channelDirName)}`).catch(() => undefined),
  ]);

  const channelTitle = metaData?.meta?.channelTitle;
  const channelId = metaData?.meta?.channelId;
  const channelUrl = metaData?.meta?.channelUrl;

  const renderVideo = (v: VideoInfo) => {
    const meta = v.meta;
    const desc = meta?.description?.trim();
    const videoUrl = meta?.url;
    return (
      <div key={v.basename} className="card">
        <div className="thumbRow">
          <a
            className="thumb"
            href={videoUrl ?? `https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`}
            target="_blank"
            rel="noreferrer"
          >
            <img src={youtubeThumb(v.videoId)} alt={v.title ?? meta?.title ?? v.videoId} loading="lazy" />
          </a>
          <div className="break flex1">
            <div className="row">
              <strong className="break">{v.title ?? meta?.title ?? v.videoId}</strong>
              <span className="pill">{v.videoId}</span>
            </div>
            <div className="muted mt8 break">
              {videoUrl ? (
                <a href={videoUrl} target="_blank" rel="noreferrer">
                  {videoUrl}
                </a>
              ) : (
                v.basename
              )}
            </div>
            {desc && <div className="muted mt8">{truncate(desc, 220)}</div>}
            <div className="spacer10" />
            <div className="row">
              <a href={`/api/library/channels/${encodeURIComponent(channelDirName)}/videos/${encodeURIComponent(v.basename)}/txt`} target="_blank" rel="noreferrer">
                TXT
              </a>
              <a href={`/api/library/channels/${encodeURIComponent(channelDirName)}/videos/${encodeURIComponent(v.basename)}/md`} target="_blank" rel="noreferrer">
                MD
              </a>
              <a href={`/api/library/channels/${encodeURIComponent(channelDirName)}/videos/${encodeURIComponent(v.basename)}/json`} target="_blank" rel="noreferrer">
                JSON
              </a>
              <a href={`/api/library/channels/${encodeURIComponent(channelDirName)}/videos/${encodeURIComponent(v.basename)}/jsonl`} target="_blank" rel="noreferrer">
                JSONL
              </a>
              <a href={`/api/library/channels/${encodeURIComponent(channelDirName)}/videos/${encodeURIComponent(v.basename)}/audio`} target="_blank" rel="noreferrer">
                Audio
              </a>
            </div>
            <VideoActions videoId={v.videoId} channelDirName={channelDirName} basename={v.basename} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="row mb12">
        <h1 className="m0">{channelTitle ?? "Channel"}</h1>
        <Link className="pill" href="/library">
          Back
        </Link>
      </div>
      <div className="flexWrap mb12">
        <span className="pill">{channelId ?? channelDirName}</span>
        <span className="muted break">{channelDirName}</span>
      </div>

      <ChannelActions
        channelId={channelId}
        channelUrl={channelUrl}
        downloadedCount={videosData.videos.length}
      />

      <div className="spacer14" />
      <div className="grid">{videosData.videos.map(renderVideo)}</div>
      {videosData.videos.length === 0 && <p className="muted">No videos found.</p>}
    </div>
  );
}

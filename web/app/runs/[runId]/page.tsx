import Link from "next/link";
import { apiGetJson } from "../../../lib/api";
import type { RunArtifactsResponse, RunRecord } from "../../../lib/apiSchema";
import { RunEvents } from "./RunEvents";
import { CancelRunButton } from "./CancelRunButton";
import { RunArtifactsLive } from "./RunArtifactsLive";

type RunResponse = { run: RunRecord };

function youtubeThumb(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}

function tryExtractVideoId(urlString: string | undefined): string | undefined {
  if (!urlString) return undefined;
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.replace(/^\//, "").trim();
    return id.length > 0 ? id : undefined;
  }
  if (host !== "youtube.com" && host !== "m.youtube.com") return undefined;
  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v") ?? "";
    return id.trim().length > 0 ? id.trim() : undefined;
  }
  const m = url.pathname.match(/^\/shorts\/([^/]+)/);
  if (m?.[1]) return m[1];
  return undefined;
}

function getFirstArtifactVideo(artifacts: unknown): { videoId?: string; title?: string } | undefined {
  const videos = (artifacts as any)?.videos;
  if (!Array.isArray(videos) || videos.length === 0) return undefined;
  const first = videos[0] as any;
  if (!first || typeof first !== "object") return undefined;
  return {
    videoId: typeof first.videoId === "string" ? first.videoId : undefined,
    title:
      typeof first.title === "string"
        ? first.title
        : undefined,
  };
}

export default async function RunPage({ params }: { params: { runId: string } }) {
  const { runId } = params;
  const runData = await apiGetJson<RunResponse>(`/runs/${runId}`);
  let artifactsData: RunArtifactsResponse;
  try {
    artifactsData = await apiGetJson<RunArtifactsResponse>(`/runs/${runId}/artifacts`);
  } catch {
    artifactsData = { run: runData.run, artifacts: { channelDirName: runData.run.channelDirName, videos: [] } };
  }
  const channelLink = runData.run.channelDirName
    ? `/library/${encodeURIComponent(runData.run.channelDirName)}`
    : undefined;
  const firstVideo = getFirstArtifactVideo(artifactsData.artifacts);
  const previewVideoId =
    runData.run.previewVideoId ?? firstVideo?.videoId ?? tryExtractVideoId(runData.run.inputUrl);
  const previewTitle = runData.run.previewTitle ?? firstVideo?.title;
  const stats = runData.run.stats;
  const channelDirName = runData.run.channelDirName;

  return (
    <div>
      <div className="row mb12">
        <h1 className="m0">Run</h1>
        <div className="flexWrap">
          {channelLink && (
            <Link href={channelLink} className="button secondary">
              Open downloads
            </Link>
          )}
          <CancelRunButton
            runId={runId}
            status={runData.run.status}
            cancelRequested={(runData.run as any).cancelRequested}
          />
          <Link href="/" className="pill">
            Back
          </Link>
        </div>
      </div>

      <div className="card mb12">
        {previewVideoId && (
          <a
            className="thumb lg mb10"
            href={`https://www.youtube.com/watch?v=${encodeURIComponent(previewVideoId)}`}
            target="_blank"
            rel="noreferrer"
          >
            <img
              src={youtubeThumb(previewVideoId)}
              alt={previewTitle ?? "Video thumbnail"}
              loading="lazy"
            />
          </a>
        )}
        {previewTitle && (
          <>
            <div className="muted">Title</div>
            <div className="break">{previewTitle}</div>
            <div className="spacer10" />
          </>
        )}
        <div className="muted">Run ID</div>
        <div className="mono">{runData.run.runId}</div>
        <div className="spacer10" />
        <div className="muted">Input URL</div>
        <div className="break">{runData.run.inputUrl}</div>
        {runData.run.channelTitle && <div className="spacer10" />}
        {runData.run.channelTitle && <div className="muted">Channel</div>}
        {runData.run.channelTitle && <div>{runData.run.channelTitle}</div>}
        <div className="spacer10" />
        <div className="muted">Status</div>
        <div>{runData.run.status}</div>
        {stats && (
          <>
            <div className="spacer10" />
            <div className="muted">Progress</div>
            <div>
              {stats.succeeded} ok, {stats.skipped} skipped, {stats.failed} failed / {stats.total} total
            </div>
          </>
        )}
        {runData.run.error && (
          <>
            <div className="spacer10" />
            <div className="muted">Error</div>
            <div className="textBad break">{runData.run.error}</div>
            <div className="muted mt8">See Events below for details.</div>
          </>
        )}
      </div>

      <div className="stack">
        <div className="card">
          <RunArtifactsLive
            runId={runId}
            initialChannelDirName={artifactsData.artifacts?.channelDirName ?? channelDirName}
            initialVideos={artifactsData.artifacts?.videos ?? []}
            runStatus={runData.run.status}
          />
        </div>
        <div className="card">
          <RunEvents runId={runId} />
        </div>
      </div>
    </div>
  );
}

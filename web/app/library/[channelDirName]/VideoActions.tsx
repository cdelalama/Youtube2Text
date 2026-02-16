"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RunCreateResponse } from "../../../lib/apiSchema";

export function VideoActions({
  videoId,
  channelDirName,
  basename,
}: {
  videoId: string;
  channelDirName: string;
  basename: string;
}) {
  const router = useRouter();
  const [rerunning, setRerunning] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fetchResult, setFetchResult] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  async function rerunVideo() {
    setRerunning(true);
    setError(undefined);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
          force: true,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`POST /runs failed: ${res.status} ${text}`);
      }
      const data = (await res.json()) as RunCreateResponse;
      router.push(`/runs/${encodeURIComponent(data.run.runId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRerunning(false);
    }
  }

  async function fetchComments() {
    setFetching(true);
    setError(undefined);
    setFetchResult(undefined);
    try {
      const res = await fetch(
        `/api/library/channels/${encodeURIComponent(channelDirName)}/videos/${encodeURIComponent(basename)}/fetch-comments`,
        { method: "POST" }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Fetch comments failed: ${res.status} ${text}`);
      }
      const data = (await res.json()) as { ok: boolean; count: number };
      setFetchResult(`${data.count} comments`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  }

  async function deleteVideo() {
    if (!window.confirm(`Delete video "${basename}" and all its files?`)) return;
    setDeleting(true);
    setError(undefined);
    try {
      const res = await fetch(
        `/api/library/channels/${encodeURIComponent(channelDirName)}/videos/${encodeURIComponent(basename)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Delete failed: ${res.status} ${text}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  return (
    <div className="row mt8">
      <button
        className="button secondary"
        type="button"
        onClick={rerunVideo}
        disabled={rerunning}
      >
        {rerunning ? "Re-running..." : "Re-run"}
      </button>
      <button
        className="button secondary"
        type="button"
        onClick={fetchComments}
        disabled={fetching}
      >
        {fetching ? "Fetching..." : "Fetch comments"}
      </button>
      <button
        className="button secondary"
        type="button"
        onClick={deleteVideo}
        disabled={deleting}
        style={{ color: "var(--bad, #c00)" }}
      >
        {deleting ? "Deleting..." : "Delete"}
      </button>
      {fetchResult && <span className="muted">{fetchResult}</span>}
      {error && <span className="muted textBad break">{error}</span>}
    </div>
  );
}

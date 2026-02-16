"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { RunPlanResponse } from "../../../lib/apiSchema";

function normalizeChannelUrl(channelUrl: string | undefined, channelId: string | undefined): string | undefined {
  const trimmed = (channelUrl ?? "").trim();
  if (trimmed.length > 0) return trimmed;
  const id = (channelId ?? "").trim();
  if (id.length === 0) return undefined;
  return `https://www.youtube.com/channel/${encodeURIComponent(id)}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ChannelActions({
  channelId,
  channelUrl,
  channelDirName,
  downloadedCount,
}: {
  channelId?: string;
  channelUrl?: string;
  channelDirName: string;
  downloadedCount: number;
}) {
  const url = useMemo(() => normalizeChannelUrl(channelUrl, channelId), [channelUrl, channelId]);
  const runUrl = url ? `/?url=${encodeURIComponent(url)}` : undefined;

  const [copied, setCopied] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [channelDeleting, setChannelDeleting] = useState(false);
  const [plan, setPlan] = useState<RunPlanResponse["plan"] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  async function onCopy() {
    if (!url) return;
    setCopied(false);
    const ok = await copyToClipboard(url);
    if (!ok) {
      window.prompt("Copy channel URL:", url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  async function computeTotals() {
    if (!url) return;
    setPlanning(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/runs/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Intentionally clear any server-side default afterDate filter so "Channel total"
        // means "total videos on the channel", not "videos after AFTER_DATE".
        body: JSON.stringify({ url, force: false, afterDate: "" }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`POST /runs/plan failed: ${res.status} ${text}`);
      }
      const json = (await res.json()) as RunPlanResponse;
      setPlan(json.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  }

  async function deleteChannel() {
    if (
      !window.confirm(
        `Delete channel "${channelDirName}" and all ${downloadedCount} video(s)? This cannot be undone.`
      )
    )
      return;
    setChannelDeleting(true);
    setError(undefined);
    try {
      const res = await fetch(
        `/api/library/channels/${encodeURIComponent(channelDirName)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Delete failed: ${res.status} ${text}`);
      }
      window.location.href = "/library";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setChannelDeleting(false);
    }
  }

  return (
    <div className="stack">
      <div className="flexWrap">
        {url ? (
          <>
            <a className="button secondary" href={url} target="_blank" rel="noreferrer">
              Open on YouTube
            </a>
            <button className="button secondary" type="button" onClick={onCopy}>
              {copied ? "Copied" : "Copy URL"}
            </button>
          </>
        ) : (
          <span className="muted">Channel URL unavailable.</span>
        )}
        {runUrl ? (
          <Link className="button" href={runUrl}>
            Run this channel
          </Link>
        ) : null}
        <button className="button secondary" type="button" onClick={computeTotals} disabled={!url || planning}>
          {planning ? "Computing..." : "Compute totals"}
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={deleteChannel}
          disabled={channelDeleting}
          style={{ color: "var(--bad, #c00)" }}
        >
          {channelDeleting ? "Deleting..." : "Delete channel"}
        </button>
      </div>

      <div className="muted">
        Downloaded videos: <strong>{downloadedCount}</strong>
        {plan ? (
          <>
            {" "}
            | Channel total: <strong>{plan.totalVideos}</strong> | Already processed:{" "}
            <strong>{plan.alreadyProcessed}</strong> | Remaining: <strong>{plan.unprocessed}</strong>
          </>
        ) : null}
      </div>

      {plan && plan.totalVideos < downloadedCount ? (
        <div className="muted textBad break">
          Warning: channel totals are smaller than downloaded videos. This usually means the plan is being filtered.
        </div>
      ) : null}

      {error ? <div className="muted textBad break">{error}</div> : null}
    </div>
  );
}

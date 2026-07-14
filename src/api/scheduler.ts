import type { RunPlan } from "../pipeline/plan.js";
import type { RunManager, RunCreateRequest, RunRecord } from "./runManager.js";
import { WatchlistEntry, WatchlistStore } from "./watchlist.js";
import { classifyYoutubeUrl } from "../youtube/url.js";

export type SchedulerStatus = {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  maxConcurrentRuns: number;
  lastTickAt?: string;
  nextTickAt?: string;
};

export type SchedulerConfig = {
  enabled: boolean;
  intervalMinutes: number;
  maxConcurrentRuns: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  const t = v.trim().toLowerCase();
  if (t === "true" || t === "1" || t === "yes") return true;
  if (t === "false" || t === "0" || t === "no") return false;
  return fallback;
}

function parseIntEnv(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function allowAnyWatchlistUrl(): boolean {
  const raw = (process.env.Y2T_WATCHLIST_ALLOW_ANY_URL ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function isRunnableWatchlistUrl(url: string): boolean {
  if (allowAnyWatchlistUrl()) return true;
  const kind = classifyYoutubeUrl(url).kind;
  return kind === "channel" || kind === "playlist";
}

export function loadSchedulerConfigFromEnv(): SchedulerConfig {
  return {
    enabled: parseBool(process.env.Y2T_SCHEDULER_ENABLED, false),
    intervalMinutes: Math.max(1, parseIntEnv(process.env.Y2T_SCHEDULER_INTERVAL_MINUTES, 60)),
    maxConcurrentRuns: Math.max(1, parseIntEnv(process.env.Y2T_SCHEDULER_MAX_CONCURRENT_RUNS, 1)),
  };
}

export type PlanFn = (url: string) => Promise<RunPlan>;
export type StartRunFn = (req: RunCreateRequest) => RunRecord;
export type StartRunAsyncFn = (runId: string, req: RunCreateRequest) => void;

function shouldCheckEntry(entry: WatchlistEntry, nowMs: number, defaultIntervalMinutes: number): boolean {
  if (!entry.enabled) return false;
  const intervalMin = entry.intervalMinutes ?? defaultIntervalMinutes;
  if (!entry.lastCheckedAt) return true;
  const lastMs = Date.parse(entry.lastCheckedAt);
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs >= intervalMin * 60 * 1000;
}

export class Scheduler {
  private running = false;
  private timer?: NodeJS.Timeout;
  private lastTickAt?: string;
  private nextTickAt?: string;
  private triggering = false;

  constructor(
    private cfg: SchedulerConfig,
    private manager: RunManager,
    private store: WatchlistStore,
    private planFn: PlanFn,
    private createRunFn: StartRunFn,
    private startRunFn: StartRunAsyncFn
  ) {}

  status(): SchedulerStatus {
    return {
      enabled: this.cfg.enabled,
      running: this.running,
      intervalMinutes: this.cfg.intervalMinutes,
      maxConcurrentRuns: this.cfg.maxConcurrentRuns,
      lastTickAt: this.lastTickAt,
      nextTickAt: this.nextTickAt,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.nextTickAt = undefined;
  }

  private scheduleNext(): void {
    if (!this.running) return;
    const delayMs = this.cfg.intervalMinutes * 60 * 1000;
    const next = new Date(Date.now() + delayMs).toISOString();
    this.nextTickAt = next;
    this.timer = setTimeout(() => {
      void this.triggerOnce().finally(() => this.scheduleNext());
    }, delayMs);
  }

  async triggerOnce(): Promise<{ checked: number; runsCreated: number }> {
    if (this.triggering) {
      return { checked: 0, runsCreated: 0 };
    }
    this.triggering = true;
    try {
      const nowMs = Date.now();
      this.lastTickAt = nowIso();

      const entries = await this.store.list();
      let checked = 0;
      let runsCreated = 0;

      for (const entry of entries) {
        if (!shouldCheckEntry(entry, nowMs, this.cfg.intervalMinutes)) continue;

        if (!isRunnableWatchlistUrl(entry.channelUrl)) {
          checked += 1;
          entry.lastCheckedAt = nowIso();
          await this.store.upsert(entry);
          continue;
        }

        // Global overload protection (includes user-triggered runs).
        const active = this.manager
          .listRuns()
          .filter((r) => r.status === "queued" || r.status === "running").length;
        if (active >= this.cfg.maxConcurrentRuns) {
          break;
        }

        checked += 1;
        let plan: RunPlan;
        try {
          plan = await this.planFn(entry.channelUrl);
        } catch {
          entry.lastCheckedAt = nowIso();
          await this.store.upsert(entry);
          continue;
        }

        entry.lastCheckedAt = nowIso();
        entry.channelId = plan.channelId;
        entry.channelTitle = plan.channelTitle;

        if (plan.toProcess > 0) {
          const req: RunCreateRequest = { url: entry.channelUrl, force: false };
          const record = this.createRunFn(req);
          this.startRunFn(record.runId, req);
          entry.lastRunId = record.runId;
          runsCreated += 1;
        }

        await this.store.upsert(entry);
      }

      return { checked, runsCreated };
    } finally {
      this.triggering = false;
    }
  }
}

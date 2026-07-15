import { createHmac, randomUUID } from "node:crypto";
import { canonicalJson } from "../transcripts/store.js";
import { logInfo, logWarn } from "../utils/logger.js";
import { MediaJobStore, type OutboxRecord } from "./store.js";

function parseEnvInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function targetUrl(): URL | undefined {
  const raw = process.env.Y2T_TRANSCRIPT_READY_URL?.trim();
  if (!raw) return undefined;
  const url = new URL(raw);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Y2T_TRANSCRIPT_READY_URL must be an HTTP(S) URL without credentials");
  }
  return url;
}

export function validateOutboxConfig(): void {
  targetUrl();
  const secret = process.env.Y2T_TRANSCRIPT_READY_SECRET?.trim();
  if (process.env.Y2T_TRANSCRIPT_READY_URL && (!secret || secret.length < 32)) {
    throw new Error(
      "Y2T_TRANSCRIPT_READY_SECRET with at least 32 characters is required when Y2T_TRANSCRIPT_READY_URL is set"
    );
  }
}

export class TranscriptReadyOutboxWorker {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopped = true;
  private intervalMs = Math.max(250, parseEnvInt("Y2T_OUTBOX_INTERVAL_MS", 1_000));
  private maxAttempts = Math.max(1, parseEnvInt("Y2T_OUTBOX_MAX_ATTEMPTS", 20));

  constructor(
    private store: MediaJobStore,
    private deps?: { fetch?: typeof fetch }
  ) {}

  start(): void {
    if (!targetUrl() || !this.stopped) return;
    const recovered = this.store.recoverExpiredOutbox();
    if (recovered > 0) logInfo(`Outbox recovered ${recovered} interrupted delivery job(s)`);
    this.stopped = false;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  isIdle(): boolean {
    return !this.busy;
  }

  async tick(): Promise<void> {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      const owner = randomUUID();
      const row = this.store.leaseNextOutbox(owner);
      if (row) await this.deliver(row, owner);
    } catch (error) {
      logWarn(`Transcript outbox tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy = false;
      if (!this.stopped) this.schedule(this.intervalMs);
    }
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async deliver(row: OutboxRecord, owner: string): Promise<void> {
    const url = targetUrl();
    const secret = process.env.Y2T_TRANSCRIPT_READY_SECRET!.trim();
    if (!url) return;
    const body = canonicalJson(row.payload);
    const timestamp = new Date().toISOString();
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1_000, parseEnvInt("Y2T_OUTBOX_TIMEOUT_MS", 10_000))
    );
    try {
      const response = await (this.deps?.fetch ?? fetch)(url, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-media2text-event": row.eventType,
          "x-media2text-event-id": row.eventId,
          "x-media2text-timestamp": timestamp,
          "x-media2text-signature": `sha256=${signature}`,
        },
        body,
      });
      if (response.ok) {
        this.store.markOutboxDelivered(row.eventId, owner);
        return;
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      this.fail(row, owner, `HTTP ${response.status}`, retryable);
    } catch (error) {
      this.fail(row, owner, error instanceof Error ? error.message : String(error), true);
    } finally {
      clearTimeout(timeout);
    }
  }

  private fail(row: OutboxRecord, owner: string, error: string, retryable: boolean): void {
    const exhausted = row.attemptCount >= this.maxAttempts;
    const dead = !retryable || exhausted;
    const delayMs = Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.min(10, row.attemptCount - 1));
    this.store.markOutboxFailed(row.eventId, owner, error, { dead, delayMs });
  }
}

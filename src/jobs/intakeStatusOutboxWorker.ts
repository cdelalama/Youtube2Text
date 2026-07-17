import { createHmac, randomUUID } from "node:crypto";
import { canonicalJson } from "../transcripts/store.js";
import { logInfo, logWarn } from "../utils/logger.js";
import {
  MediaJobStore,
  type IntakeStatusOutboxRecord,
} from "./store.js";
import {
  loadTranscriptionProfiles,
  transcriptionProfileForAuthority,
} from "./transcriptionProfile.js";

function parseEnvInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

export class IntakeStatusOutboxWorker {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopped = true;
  private intervalMs = Math.max(250, parseEnvInt("Y2T_INTAKE_STATUS_OUTBOX_INTERVAL_MS", 1_000));
  private maxAttempts = Math.max(1, parseEnvInt("Y2T_INTAKE_STATUS_OUTBOX_MAX_ATTEMPTS", 20));

  constructor(
    private store: MediaJobStore,
    private deps?: { fetch?: typeof fetch }
  ) {}

  start(): void {
    if (
      process.env.Y2T_INTAKE_STATUS_OUTBOX_ENABLED?.trim().toLowerCase() === "false" ||
      loadTranscriptionProfiles().length === 0 ||
      !this.stopped
    ) return;
    const recovered = this.store.recoverExpiredIntakeStatusOutbox();
    if (recovered > 0) {
      logInfo(`Intake status outbox recovered ${recovered} interrupted delivery job(s)`);
    }
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
      const row = this.store.leaseNextIntakeStatusOutbox(owner);
      if (row) await this.deliver(row, owner);
    } catch (error) {
      logWarn(`Intake status outbox tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy = false;
      if (!this.stopped) this.schedule(this.intervalMs);
    }
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async deliver(row: IntakeStatusOutboxRecord, owner: string): Promise<void> {
    const profile = transcriptionProfileForAuthority(row.sourceAuthority);
    if (!profile) {
      this.store.markIntakeStatusOutboxFailed(
        row.eventId,
        owner,
        `No producer profile for authority ${row.sourceAuthority}`,
        { dead: true }
      );
      return;
    }
    const body = canonicalJson(row.payload);
    const timestamp = new Date().toISOString();
    const signature = createHmac("sha256", profile.statusHmacSecret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1_000, parseEnvInt("Y2T_INTAKE_STATUS_OUTBOX_TIMEOUT_MS", 10_000))
    );
    try {
      const response = await (this.deps?.fetch ?? fetch)(row.callbackUrl, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-transcription-timestamp": timestamp,
          "x-transcription-signature": `sha256=${signature}`,
        },
        body,
      });
      if (response.ok) {
        this.store.markIntakeStatusOutboxDelivered(row.eventId, owner);
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

  private fail(
    row: IntakeStatusOutboxRecord,
    owner: string,
    error: string,
    retryable: boolean
  ): void {
    const exhausted = row.attemptCount >= this.maxAttempts;
    const dead = !retryable || exhausted;
    const delayMs = Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.min(10, row.attemptCount - 1));
    this.store.markIntakeStatusOutboxFailed(row.eventId, owner, error, { dead, delayMs });
  }
}

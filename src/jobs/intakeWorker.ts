import { randomUUID } from "node:crypto";
import type { RunManager, RunRecord } from "../api/runManager.js";
import type { AppConfig } from "../config/schema.js";
import { logInfo, logWarn } from "../utils/logger.js";
import { ArtifactFetchError, fetchIntakeArtifact } from "./artifactFetcher.js";
import { prepareIntakeAudioForProvider } from "./intakeAudio.js";
import { MediaJobStore, type IntakeRecord } from "./store.js";

function parseEnvInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function isEnabled(): boolean {
  const raw = (process.env.Y2T_INTAKE_WORKER_ENABLED ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

async function waitForRun(manager: RunManager, runId: string): Promise<RunRecord> {
  return await new Promise<RunRecord>((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => {};
    const settle = (run: RunRecord) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(run);
    };
    unsubscribe = manager.subscribeGlobal((buffered) => {
      const run = buffered.event.run;
      if (run.runId !== runId || run.status === "queued" || run.status === "running") return;
      settle(run);
    });
    const current = manager.getRun(runId);
    if (!current) {
      settled = true;
      unsubscribe();
      reject(new Error("Intake run disappeared"));
      return;
    }
    if (current.status !== "queued" && current.status !== "running") settle(current);
  });
}

export class IntakeWorker {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopped = true;
  private intervalMs = Math.max(250, parseEnvInt("Y2T_INTAKE_WORKER_INTERVAL_MS", 1_000));
  private leaseMs = Math.max(60_000, parseEnvInt("Y2T_INTAKE_LEASE_MS", 300_000));
  private maxFetchAttempts = Math.max(1, parseEnvInt("Y2T_INTAKE_FETCH_ATTEMPTS", 5));

  constructor(
    private store: MediaJobStore,
    private manager: RunManager,
    private config: AppConfig
  ) {}

  start(): void {
    if (!isEnabled() || !this.stopped) return;
    const recovered = this.store.recoverExpiredIntakes();
    if (recovered > 0) logInfo(`Intake worker recovered ${recovered} interrupted job(s)`);
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
      const intake = this.store.leaseNextIntake(owner, this.leaseMs);
      if (!intake) return;
      if (intake.status === "fetching") {
        await this.fetch(intake, owner);
      } else if (intake.status === "running") {
        await this.transcribe(intake, owner);
      }
    } catch (error) {
      logWarn(`Intake worker tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy = false;
      if (!this.stopped) this.schedule(this.intervalMs);
    }
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async fetch(intake: IntakeRecord, owner: string): Promise<void> {
    try {
      const path = await fetchIntakeArtifact(intake, this.config.audioDir, {
        timeoutMs: Math.max(1_000, parseEnvInt("Y2T_INTAKE_FETCH_TIMEOUT_MS", 120_000)),
        maxBytes:
          Math.max(1, parseEnvInt("Y2T_INTAKE_MAX_ARTIFACT_MB", 2048)) * 1024 * 1024,
      });
      this.store.markIntakeReady(intake.intakeId, owner, path);
    } catch (error) {
      const fetchError =
        error instanceof ArtifactFetchError
          ? error
          : new ArtifactFetchError(
              "artifact_fetch_failed",
              error instanceof Error ? error.message : String(error),
              true
            );
      if (fetchError.retryable && intake.attemptCount < this.maxFetchAttempts) {
        const delayMs = Math.min(60 * 60_000, 10_000 * 2 ** Math.max(0, intake.attemptCount - 1));
        this.store.requeueIntakeFetch(
          intake.intakeId,
          owner,
          fetchError.code,
          fetchError.message,
          new Date(Date.now() + delayMs)
        );
      } else {
        this.store.markIntakeFailed(
          intake.intakeId,
          owner,
          "fetching",
          fetchError.code,
          fetchError.message
        );
      }
    }
  }

  private async transcribe(intake: IntakeRecord, owner: string): Promise<void> {
    if (!intake.localPath) {
      this.store.markIntakeFailed(
        intake.intakeId,
        owner,
        "running",
        "artifact_missing",
        "Fetched artifact path is missing"
      );
      return;
    }
    const request = intake.request;
    let providerAudioPath: string;
    try {
      providerAudioPath = await prepareIntakeAudioForProvider(
        intake.localPath,
        request.artifact.contentType
      );
    } catch (error) {
      this.store.markIntakeFailed(
        intake.intakeId,
        owner,
        "running",
        "audio_normalization_failed",
        error instanceof Error ? error.message : String(error)
      );
      return;
    }
    const runRequest = {
      audioId: intake.intakeId,
      audioPath: providerAudioPath,
      sourceArtifact: {
        path: intake.localPath,
        artifactRevision: request.source.artifactRevision,
        contentType: request.artifact.contentType,
        durationSeconds: request.artifact.durationSeconds,
      },
      audioTitle: request.title ?? request.artifact.filename ?? request.source.itemId,
      audioOriginalFilename: request.artifact.filename,
      intakeId: intake.intakeId,
      sourceAuthority: request.source.authority,
      sourceItemId: request.source.itemId,
      sourceCollectionId: request.source.collectionId,
      force: false,
    };
    const run = this.manager.createRun(runRequest);
    this.store.markIntakeRun(intake.intakeId, owner, run.runId);
    const renewal = setInterval(
      () => this.store.renewIntakeLease(intake.intakeId, owner, this.leaseMs),
      Math.max(30_000, Math.floor(this.leaseMs / 3))
    );
    renewal.unref?.();
    try {
      this.manager.startRun(run.runId, runRequest);
      const finished = await waitForRun(this.manager, run.runId);
      const result = finished.videoResults?.find(
        (item) => item.status === "done" && item.transcriptId && item.transcriptRecordSha256
      );
      if (finished.status === "done" && result?.transcriptId && result.transcriptRecordSha256) {
        this.store.markIntakeCompleted(
          intake.intakeId,
          owner,
          result.transcriptId,
          result.transcriptRecordSha256
        );
      } else {
        this.store.markIntakeFailed(
          intake.intakeId,
          owner,
          "running",
          "transcription_failed",
          finished.error ?? `Run ended with ${finished.status}`
        );
      }
    } finally {
      clearInterval(renewal);
    }
  }
}

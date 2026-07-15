import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AppConfig } from "../config/schema.js";
import { runPipeline } from "../pipeline/run.js";
import type { PipelineEvent, PipelineEventEmitter } from "../pipeline/events.js";
import { EventBuffer } from "./eventBuffer.js";
import { FileSystemStorageAdapter } from "../storage/index.js";
import { makeChannelDirName } from "../storage/naming.js";
import { sanitizeConfigOverrides } from "./sanitize.js";
import { deliverRunTerminalWebhook } from "./webhooks.js";
import type { RunPlan } from "../pipeline/plan.js";
import {
  appendEvent,
  createRunPersistence,
  loadPersistedEventsTail,
  loadPersistedRuns,
  RunPersistence,
  writeRunRecord,
} from "./persistence.js";
import { ensureDir } from "../utils/fs.js";

export type RunStatus = "queued" | "running" | "done" | "error" | "cancelled";

export type RunRecord = {
  runId: string;
  status: RunStatus;
  inputUrl: string;
  force: boolean;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancelRequested?: boolean;
  error?: string;
  callbackUrl?: string;
  channelId?: string;
  channelTitle?: string;
  channelDirName?: string;
  previewVideoId?: string;
  previewTitle?: string;
  stats?: { succeeded: number; failed: number; skipped: number; total: number };
  videoResults?: Array<{
    videoId: string;
    basename: string;
    status: "done" | "error" | "skipped";
    transcriptId?: string;
    transcriptRecordSha256?: string;
  }>;
};

export type GlobalEvent =
  | {
      type: "run:created";
      run: RunRecord;
      timestamp: string;
    }
  | {
      type: "run:updated";
      run: RunRecord;
      timestamp: string;
    };

export type RunCreateRequest = {
  url?: string;
  audioId?: string;
  audioPath?: string;
  audioTitle?: string;
  audioOriginalFilename?: string;
  intakeId?: string;
  sourceAuthority?: string;
  sourceItemId?: string;
  sourceCollectionId?: string;
  canonicalUrl?: string;
  force?: boolean;
  callbackUrl?: string;
  config?: Partial<AppConfig>;
};

export type RunManagerOptions = {
  maxBufferedEventsPerRun: number;
  maxEventBytes?: number;
  persistRuns: boolean;
  persistDir?: string;
  runTimeoutMs?: number;
  deps?: { runPipeline?: typeof runPipeline };
};

export class RunManager {
  private runs = new Map<string, RunRecord>();
  private buffers = new Map<string, EventBuffer<PipelineEvent>>();
  private listeners = new Map<
    string,
    Set<(buffered: { id: number; event: PipelineEvent }) => void>
  >();
  private globalBuffer: EventBuffer<GlobalEvent>;
  private globalListeners = new Set<
    (buffered: { id: number; event: GlobalEvent }) => void
  >();
  private persistence?: RunPersistence;
  private persistChain: Promise<void> = Promise.resolve();
  private abortControllers = new Map<string, AbortController>();
  private runTimeouts = new Map<string, NodeJS.Timeout>();
  private runPipelineFn: typeof runPipeline;
  private activeRunPromises = new Map<string, Promise<void>>();
  private runTimeoutMs?: number;

  constructor(
    private baseConfig: AppConfig,
    private options: RunManagerOptions
  ) {
    this.globalBuffer = new EventBuffer<GlobalEvent>(
      Math.max(200, options.maxBufferedEventsPerRun),
      options.maxEventBytes
    );
    if (options.persistRuns) {
      const dir = options.persistDir ?? join(baseConfig.outputDir, "_runs");
      this.persistence = createRunPersistence(dir);
    }
    this.runPipelineFn = options.deps?.runPipeline ?? runPipeline;
    this.runTimeoutMs = options.runTimeoutMs;
  }

  async init(): Promise<void> {
    if (!this.persistence) return;
    await ensureDir(this.persistence.rootDir);
    const persisted = await loadPersistedRuns(this.persistence);
    for (const record of persisted) {
      const reconciled = this.reconcilePersistedRun(record, new Date().toISOString());
      this.runs.set(reconciled.runId, reconciled);
      const buffer = new EventBuffer<PipelineEvent>(
        this.options.maxBufferedEventsPerRun,
        this.options.maxEventBytes
      );
      const events = await loadPersistedEventsTail(
        this.persistence,
        record.runId,
        this.options.maxBufferedEventsPerRun
      );
      let maxId = 0;
      for (const e of events) {
        buffer.appendWithId(e.id, e.event);
        maxId = Math.max(maxId, e.id);
      }
      buffer.setNextId(maxId + 1);
      this.buffers.set(record.runId, buffer);
      this.listeners.set(record.runId, new Set());
      if (reconciled !== record) {
        await writeRunRecord(this.persistence, reconciled);
      }
    }
  }

  async flush(): Promise<void> {
    await this.persistChain;
  }

  createRun(req: RunCreateRequest): RunRecord {
    const runId = randomUUID();
    const inputUrl = req.url ?? (req.audioId ? `audio:${req.audioId}` : "");
    if (!inputUrl) {
      throw new Error("Run must include url or audioId");
    }
    const record: RunRecord = {
      runId,
      status: "queued",
      inputUrl,
      force: Boolean(req.force),
      createdAt: new Date().toISOString(),
      callbackUrl: req.callbackUrl,
    };
    this.runs.set(runId, record);
    this.buffers.set(
      runId,
      new EventBuffer<PipelineEvent>(
        this.options.maxBufferedEventsPerRun,
        this.options.maxEventBytes
      )
    );
    this.listeners.set(runId, new Set());
    this.persistRun(record);
    this.emitGlobal({ type: "run:created", run: record, timestamp: new Date().toISOString() });
    return record;
  }

  createCachedRun(req: RunCreateRequest, plan: RunPlan): RunRecord {
    const record = this.createRun(req);
    const now = new Date().toISOString();

    record.status = "done";
    record.startedAt = now;
    record.finishedAt = now;
    record.channelId = plan.channelId;
    record.channelTitle = plan.channelTitle;
    record.channelDirName = makeChannelDirName(plan.channelId, plan.channelTitle);

    const only = plan.videos[0];
    if (only) {
      record.previewVideoId = only.id;
      record.previewTitle = only.title;
      record.stats = { succeeded: 0, failed: 0, skipped: 1, total: 1 };
      record.videoResults = [
        { videoId: only.id, basename: only.basename, status: "skipped" },
      ];
    }

    this.persistRun(record);
    this.emitGlobal({ type: "run:updated", run: record, timestamp: now });
    void deliverRunTerminalWebhook(record, "run:done");
    return record;
  }

  getRun(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  getActiveRunCount(): number {
    return this.activeRunPromises.size;
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    const waitAll = Promise.allSettled(Array.from(this.activeRunPromises.values())).then(
      () => true
    );
    const timeout = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), Math.max(0, timeoutMs))
    );
    return Promise.race([waitAll, timeout]);
  }

  cancelRun(runId: string): RunRecord | undefined {
    const run = this.getRun(runId);
    if (!run) return undefined;
    const now = new Date().toISOString();

    if (run.status === "queued") {
      run.status = "cancelled";
      run.cancelRequested = true;
      run.finishedAt = now;
      this.persistRun(run);
      this.emitGlobal({ type: "run:updated", run, timestamp: now });
      void deliverRunTerminalWebhook(run, "run:cancelled");
      return run;
    }

    if (run.status === "running") {
      run.cancelRequested = true;
      this.persistRun(run);
      this.emitGlobal({ type: "run:updated", run, timestamp: now });
      this.abortControllers.get(runId)?.abort();
      return run;
    }

    return run;
  }

  listRuns(): RunRecord[] {
    return Array.from(this.runs.values()).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1
    );
  }

  subscribe(
    runId: string,
    handler: (buffered: { id: number; event: PipelineEvent }) => void
  ): () => void {
    const set = this.listeners.get(runId);
    if (!set) throw new Error("Unknown run");
    set.add(handler);
    return () => set.delete(handler);
  }

  subscribeGlobal(
    handler: (buffered: { id: number; event: GlobalEvent }) => void
  ): () => void {
    this.globalListeners.add(handler);
    return () => this.globalListeners.delete(handler);
  }

  listGlobalEventsAfter(lastSeenId: number) {
    return this.globalBuffer.listAfter(lastSeenId);
  }

  listEventsAfter(runId: string, lastSeenId: number) {
    const buffer = this.buffers.get(runId);
    if (!buffer) throw new Error("Unknown run");
    return buffer.listAfter(lastSeenId);
  }

  async listArtifacts(runId: string) {
    const run = this.getRun(runId);
    if (!run) throw new Error("Unknown run");
    if (!run.channelDirName) {
      return { channelDirName: undefined, videos: [] as unknown[] };
    }
    const adapter = new FileSystemStorageAdapter({
      outputDir: this.baseConfig.outputDir,
      audioDir: this.baseConfig.audioDir,
      audioFormat: this.baseConfig.audioFormat,
    });
    const runVideoIds = new Set(run.videoResults?.map((result) => result.videoId) ?? []);
    const runBasenames = new Set(run.videoResults?.map((result) => result.basename) ?? []);
    if (runVideoIds.size === 0 && run.previewVideoId) {
      runVideoIds.add(run.previewVideoId);
    }
    const videos = (await adapter.listVideos(run.channelDirName)).filter(
      (video) => runVideoIds.has(video.videoId) || runBasenames.has(video.basename)
    );
    return {
      channelDirName: run.channelDirName,
      channelId: run.channelId,
      channelTitle: run.channelTitle,
      videos,
    };
  }

  startRun(runId: string, req: RunCreateRequest): void {
    const run = this.getRun(runId);
    if (!run) throw new Error("Unknown run");
    if (run.status !== "queued") throw new Error("Run already started");

    const sanitizedOverrides = sanitizeConfigOverrides(req.config);
    const config = { ...this.baseConfig, ...sanitizedOverrides };
    const emitter: PipelineEventEmitter = {
      emit: (event) => this.onEvent(runId, event),
    };
    const controller = new AbortController();
    this.abortControllers.set(runId, controller);
    if (this.runTimeoutMs && this.runTimeoutMs > 0) {
      const handle = setTimeout(() => this.onRunTimeout(runId), this.runTimeoutMs);
      this.runTimeouts.set(runId, handle);
    }

    run.status = "running";
    run.startedAt = new Date().toISOString();
    this.persistRun(run);
    this.emitGlobal({ type: "run:updated", run, timestamp: new Date().toISOString() });

    const pipelineInput =
      req.audioId && req.audioPath
        ? {
            kind: "audio" as const,
            audioId: req.audioId,
            audioPath: req.audioPath,
            title: req.audioTitle,
            originalFilename: req.audioOriginalFilename,
            intakeId: req.intakeId,
            sourceAuthority: req.sourceAuthority,
            sourceItemId: req.sourceItemId,
            sourceCollectionId: req.sourceCollectionId,
            canonicalUrl: req.canonicalUrl,
          }
        : (req.url as string);

    const p = this.runPipelineFn(pipelineInput, config, {
      force: Boolean(req.force),
      emitter,
      abortSignal: controller.signal,
      runId,
    })
      .then(() => {
        const updated = this.runs.get(runId);
        if (!updated) return;
        if (updated.status !== "running") return;
        if (updated.cancelRequested) {
          updated.status = "cancelled";
          updated.finishedAt = new Date().toISOString();
          this.persistRun(updated);
          this.emitGlobal({
            type: "run:updated",
            run: updated,
            timestamp: new Date().toISOString(),
          });
          void deliverRunTerminalWebhook(updated, "run:cancelled");
          return;
        }
        updated.status = "done";
        updated.finishedAt = new Date().toISOString();
        this.persistRun(updated);
        this.emitGlobal({
          type: "run:updated",
          run: updated,
          timestamp: new Date().toISOString(),
        });
        void deliverRunTerminalWebhook(updated, "run:done");
      })
      .catch((error) => {
        const updated = this.runs.get(runId);
        if (!updated) return;
        updated.status = "error";
        updated.finishedAt = new Date().toISOString();
        updated.error = error instanceof Error ? error.message : String(error);
        this.persistRun(updated);
        this.emitGlobal({
          type: "run:updated",
          run: updated,
          timestamp: new Date().toISOString(),
        });
        void deliverRunTerminalWebhook(updated, "run:error");
      })
      .finally(() => {
        this.abortControllers.delete(runId);
        this.activeRunPromises.delete(runId);
        const handle = this.runTimeouts.get(runId);
        if (handle) clearTimeout(handle);
        this.runTimeouts.delete(runId);
      });
    this.activeRunPromises.set(runId, p);
  }

  private onRunTimeout(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    if (run.status !== "running") return;

    run.status = "error";
    run.finishedAt = new Date().toISOString();
    run.error = `timeout after ${Math.ceil((this.runTimeoutMs ?? 0) / 60000)} minutes`;
    run.cancelRequested = true;
    this.persistRun(run);
    this.emitGlobal({ type: "run:updated", run, timestamp: new Date().toISOString() });
    this.abortControllers.get(runId)?.abort();
    void deliverRunTerminalWebhook(run, "run:error");
  }

  private onEvent(runId: string, event: PipelineEvent) {
    const buffer = this.buffers.get(runId);
    if (!buffer) return;
    const buffered = buffer.append(event);
    this.persistEvent(runId, buffered.id, event);

    const run = this.runs.get(runId);
    if (run) {
      if (!run.previewVideoId) {
        if (event.type === "video:start") {
          run.previewVideoId = event.videoId;
          run.previewTitle = event.title;
          this.persistRun(run);
          this.emitGlobal({ type: "run:updated", run, timestamp: new Date().toISOString() });
        } else if (event.type === "video:skip" || event.type === "video:done" || event.type === "video:error") {
          run.previewVideoId = event.videoId;
          this.persistRun(run);
          this.emitGlobal({ type: "run:updated", run, timestamp: new Date().toISOString() });
        }
      }
      if (event.type === "video:done" || event.type === "video:error" || event.type === "video:skip") {
        if (!run.videoResults) run.videoResults = [];
        const status = event.type === "video:done" ? "done" : event.type === "video:error" ? "error" : "skipped";
        run.videoResults.push({
          videoId: event.videoId,
          basename: event.basename,
          status,
          ...(event.type === "video:done"
            ? {
                transcriptId: event.transcriptId,
                transcriptRecordSha256: event.transcriptRecordSha256,
              }
            : {}),
        });
      }
      if (event.type === "run:start") {
        run.channelId = event.channelId;
        run.channelTitle = event.channelTitle;
        run.channelDirName =
          event.channelDirName ?? makeChannelDirName(event.channelId, event.channelTitle);
        this.persistRun(run);
        this.emitGlobal({ type: "run:updated", run, timestamp: new Date().toISOString() });
      }
      if (event.type === "run:done") {
        run.stats = {
          succeeded: event.succeeded,
          failed: event.failed,
          skipped: event.skipped,
          total: event.total,
        };
        this.persistRun(run);
        this.emitGlobal({ type: "run:updated", run, timestamp: new Date().toISOString() });
        if (!run.previewTitle && run.channelDirName) {
          void this.tryEnrichPreviewFromArtifacts(run);
        }
      }
      if (event.type === "run:cancelled") {
        run.cancelRequested = true;
        run.status = "cancelled";
        run.finishedAt = new Date().toISOString();
        run.stats = {
          succeeded: event.succeeded,
          failed: event.failed,
          skipped: event.skipped,
          total: event.total,
        };
        this.persistRun(run);
        this.emitGlobal({ type: "run:updated", run, timestamp: new Date().toISOString() });
        void deliverRunTerminalWebhook(run, "run:cancelled");
        if (!run.previewTitle && run.channelDirName) {
          void this.tryEnrichPreviewFromArtifacts(run);
        }
      }
      if (event.type === "run:error") {
        run.error = event.error;
        this.persistRun(run);
        this.emitGlobal({ type: "run:updated", run, timestamp: new Date().toISOString() });
      }
    }

    const handlers = this.listeners.get(runId);
    if (!handlers) return;
    for (const handler of handlers) handler(buffered);
  }

  private emitGlobal(event: GlobalEvent) {
    const buffered = this.globalBuffer.append(event);
    for (const handler of this.globalListeners) handler(buffered);
  }

  private enqueuePersist(task: () => Promise<void>) {
    this.persistChain = this.persistChain.then(task).catch((error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      console.warn("[api] Persist failure:", err);
    });
  }

  private persistRun(record: RunRecord) {
    if (!this.persistence) return;
    this.enqueuePersist(() => writeRunRecord(this.persistence!, record));
  }

  private persistEvent(runId: string, id: number, event: PipelineEvent) {
    if (!this.persistence) return;
    this.enqueuePersist(() => appendEvent(this.persistence!, runId, { id, event }));
  }

  private reconcilePersistedRun(record: RunRecord, now: string): RunRecord {
    if (record.status !== "queued" && record.status !== "running") return record;

    return {
      ...record,
      status: "error",
      finishedAt: record.finishedAt ?? now,
      error:
        record.error ??
        `interrupted: server restarted while run was ${record.status}`,
    };
  }

  private async tryEnrichPreviewFromArtifacts(run: RunRecord): Promise<void> {
    try {
      if (!run.channelDirName) return;
      const adapter = new FileSystemStorageAdapter({
        outputDir: this.baseConfig.outputDir,
        audioDir: this.baseConfig.audioDir,
        audioFormat: this.baseConfig.audioFormat,
      });
      const videos = await adapter.listVideos(run.channelDirName);
      const first = videos[0];
      if (!first) return;

      let changed = false;
      if (!run.previewVideoId && first.videoId) {
        run.previewVideoId = first.videoId;
        changed = true;
      }
      if (!run.previewTitle && (first.title || first.meta?.title)) {
        run.previewTitle = first.title ?? first.meta?.title;
        changed = true;
      }
      if (!changed) return;

      this.persistRun(run);
      this.emitGlobal({ type: "run:updated", run, timestamp: new Date().toISOString() });
    } catch {
      // best-effort only
    }
  }
}

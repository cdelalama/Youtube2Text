import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { SttProviderId } from "../config/schema.js";
import { ensureDir, writeJson } from "../utils/fs.js";
import { loadUsagePolicyFromEnv, type UsagePolicy } from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 400 * DAY_MS;
const LOCK_STALE_MS = 60_000;
const LOCK_WAIT_MS = 5_000;

export type UsageScope = "item" | "run" | "source_24h" | "total_30d" | "usd_30d";
export type UsageStatus = "reserved" | "completed" | "failed" | "released";

export type UsageReservation = {
  reservationId: string;
  reservedAt: string;
  finishedAt?: string;
  status: UsageStatus;
  runId: string;
  sourceId: string;
  itemId: string;
  provider: SttProviderId;
  audioSeconds: number;
  estimatedUsd: number;
};

type UsageLedgerState = {
  version: 1;
  updatedAt: string;
  reservations: UsageReservation[];
};

export type UsageRequest = {
  runId: string;
  sourceId: string;
  itemId: string;
  provider: SttProviderId;
  audioSeconds: number;
  itemSeconds?: number;
};

export type UsageViolation = {
  scope: UsageScope;
  limit: number;
  projected: number;
  unit: "minutes" | "usd";
};

export type UsageDecision = {
  allowed: boolean;
  enforced: boolean;
  estimatedUsd: number;
  violations: UsageViolation[];
};

export type UsageEstimate = {
  provider: SttProviderId;
  knownItems: number;
  unknownItems: number;
  audioMinutes: number;
  estimatedUsd: number;
  complete: boolean;
  allowed: boolean | null;
  enforced: boolean;
  violations: UsageViolation[];
};

export type UsageSnapshot = {
  generatedAt: string;
  currency: "USD";
  policy: UsagePolicy;
  last24h: UsagePeriodSnapshot;
  last30d: UsagePeriodSnapshot;
  pendingReservations: number;
  failedReservations: number;
};

export type UsagePeriodSnapshot = {
  audioMinutes: number;
  estimatedUsd: number;
  reservations: number;
  byProvider: Array<{
    provider: SttProviderId;
    audioMinutes: number;
    estimatedUsd: number;
    reservations: number;
  }>;
};

export class UsageLimitExceededError extends Error {
  name = "UsageLimitExceededError";

  constructor(public decision: UsageDecision) {
    const first = decision.violations[0];
    const detail = first
      ? `${first.scope} projected ${first.projected.toFixed(2)} ${first.unit} exceeds ${first.limit.toFixed(2)}`
      : "usage policy denied the request";
    super(`Usage limit exceeded: ${detail}`);
  }
}

type UsageLedgerOptions = {
  policy?: UsagePolicy;
  now?: () => Date;
};

function emptyState(now: Date): UsageLedgerState {
  return { version: 1, updatedAt: now.toISOString(), reservations: [] };
}

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sum(reservations: UsageReservation[], field: "audioSeconds" | "estimatedUsd"): number {
  return reservations.reduce((total, reservation) => total + reservation[field], 0);
}

function periodSnapshot(reservations: UsageReservation[]): UsagePeriodSnapshot {
  const providers: SttProviderId[] = ["assemblyai", "deepgram", "openai_whisper"];
  return {
    audioMinutes: round(sum(reservations, "audioSeconds") / 60),
    estimatedUsd: round(sum(reservations, "estimatedUsd")),
    reservations: reservations.length,
    byProvider: providers.map((provider) => {
      const selected = reservations.filter((reservation) => reservation.provider === provider);
      return {
        provider,
        audioMinutes: round(sum(selected, "audioSeconds") / 60),
        estimatedUsd: round(sum(selected, "estimatedUsd")),
        reservations: selected.length,
      };
    }),
  };
}

function isUsageReservation(value: unknown): value is UsageReservation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UsageReservation>;
  return (
    typeof candidate.reservationId === "string" &&
    candidate.reservationId.length > 0 &&
    typeof candidate.reservedAt === "string" &&
    Number.isFinite(Date.parse(candidate.reservedAt)) &&
    (candidate.finishedAt === undefined ||
      (typeof candidate.finishedAt === "string" &&
        Number.isFinite(Date.parse(candidate.finishedAt)))) &&
    (candidate.status === "reserved" ||
      candidate.status === "completed" ||
      candidate.status === "failed" ||
      candidate.status === "released") &&
    typeof candidate.runId === "string" &&
    candidate.runId.length > 0 &&
    typeof candidate.sourceId === "string" &&
    candidate.sourceId.length > 0 &&
    typeof candidate.itemId === "string" &&
    candidate.itemId.length > 0 &&
    (candidate.provider === "assemblyai" ||
      candidate.provider === "deepgram" ||
      candidate.provider === "openai_whisper") &&
    typeof candidate.audioSeconds === "number" &&
    Number.isFinite(candidate.audioSeconds) &&
    candidate.audioSeconds > 0 &&
    typeof candidate.estimatedUsd === "number" &&
    Number.isFinite(candidate.estimatedUsd) &&
    candidate.estimatedUsd >= 0
  );
}

export class UsageLedger {
  readonly policy: UsagePolicy;
  private readonly usageDir: string;
  private readonly ledgerPath: string;
  private readonly lockPath: string;
  private readonly now: () => Date;

  constructor(outputDir: string, options: UsageLedgerOptions = {}) {
    this.policy = options.policy ?? loadUsagePolicyFromEnv();
    this.usageDir = join(outputDir, "_usage");
    this.ledgerPath = join(this.usageDir, "ledger.json");
    this.lockPath = join(this.usageDir, ".ledger.lock");
    this.now = options.now ?? (() => new Date());
  }

  async reserve(request: UsageRequest): Promise<UsageReservation> {
    const reservations = await this.reserveBatch([request]);
    return reservations[0]!;
  }

  async reserveBatch(requests: UsageRequest[]): Promise<UsageReservation[]> {
    if (requests.length === 0) return [];
    for (const request of requests) this.validateRequest(request);
    return this.withLock(async () => {
      const now = this.now();
      const state = await this.readState(now);
      const active = state.reservations.filter(
        (reservation) => reservation.status !== "released"
      );
      const created: UsageReservation[] = [];
      for (const request of requests) {
        const decision = this.evaluate(active, request, now);
        if (!decision.allowed) throw new UsageLimitExceededError(decision);
        const reservation: UsageReservation = {
          reservationId: randomUUID(),
          reservedAt: now.toISOString(),
          status: "reserved",
          runId: request.runId,
          sourceId: request.sourceId,
          itemId: request.itemId,
          provider: request.provider,
          audioSeconds: request.audioSeconds,
          estimatedUsd: decision.estimatedUsd,
        };
        active.push(reservation);
        created.push(reservation);
      }
      state.reservations.push(...created);
      await this.writeState(state, now);
      return created;
    });
  }

  async finish(
    reservationId: string,
    status: "completed" | "failed" | "released"
  ): Promise<void> {
    await this.withLock(async () => {
      const now = this.now();
      const state = await this.readState(now);
      const reservation = state.reservations.find(
        (candidate) => candidate.reservationId === reservationId
      );
      if (!reservation) throw new Error(`Unknown usage reservation: ${reservationId}`);
      reservation.status = status;
      reservation.finishedAt = now.toISOString();
      await this.writeState(state, now);
    });
  }

  async estimate(
    requests: UsageRequest[],
    unknownItems = 0,
    providerFallback: SttProviderId = "assemblyai"
  ): Promise<UsageEstimate> {
    const now = this.now();
    const state = await this.readState(now);
    const projected = state.reservations.filter(
      (reservation) => reservation.status !== "released"
    );
    const violations: UsageViolation[] = [];
    let estimatedUsd = 0;
    let audioSeconds = 0;

    for (const request of requests) {
      this.validateRequest(request);
      const decision = this.evaluate(projected, request, now);
      estimatedUsd += decision.estimatedUsd;
      audioSeconds += request.audioSeconds;
      violations.push(...decision.violations);
      projected.push({
        reservationId: `estimate-${projected.length}`,
        reservedAt: now.toISOString(),
        status: "reserved",
        runId: request.runId,
        sourceId: request.sourceId,
        itemId: request.itemId,
        provider: request.provider,
        audioSeconds: request.audioSeconds,
        estimatedUsd: decision.estimatedUsd,
      });
    }

    const uniqueViolations = violations.filter((violation, index, all) =>
      all.findIndex((candidate) => candidate.scope === violation.scope) === index
    );
    const complete = unknownItems === 0;
    const blocked = this.policy.enforcement === "enforce" && uniqueViolations.length > 0;
    return {
      provider: requests[0]?.provider ?? providerFallback,
      knownItems: requests.length,
      unknownItems,
      audioMinutes: round(audioSeconds / 60),
      estimatedUsd: round(estimatedUsd),
      complete,
      allowed: blocked ? false : complete ? true : null,
      enforced: this.policy.enforcement === "enforce",
      violations: uniqueViolations,
    };
  }

  async snapshot(): Promise<UsageSnapshot> {
    const now = this.now();
    const state = await this.readState(now);
    const active = state.reservations.filter(
      (reservation) => reservation.status !== "released"
    );
    const cutoff24h = now.getTime() - DAY_MS;
    const cutoff30d = now.getTime() - 30 * DAY_MS;
    const last24h = active.filter(
      (reservation) => Date.parse(reservation.reservedAt) >= cutoff24h
    );
    const last30d = active.filter(
      (reservation) => Date.parse(reservation.reservedAt) >= cutoff30d
    );
    return {
      generatedAt: now.toISOString(),
      currency: "USD",
      policy: this.policy,
      last24h: periodSnapshot(last24h),
      last30d: periodSnapshot(last30d),
      pendingReservations: state.reservations.filter(
        (reservation) => reservation.status === "reserved"
      ).length,
      failedReservations: state.reservations.filter(
        (reservation) => reservation.status === "failed"
      ).length,
    };
  }

  private evaluate(
    reservations: UsageReservation[],
    request: UsageRequest,
    now: Date
  ): UsageDecision {
    const estimatedUsd = round(
      (request.audioSeconds / 3600) * this.policy.ratesUsdPerHour[request.provider]
    );
    const nowMs = now.getTime();
    const last24h = reservations.filter(
      (reservation) => Date.parse(reservation.reservedAt) >= nowMs - DAY_MS
    );
    const last30d = reservations.filter(
      (reservation) => Date.parse(reservation.reservedAt) >= nowMs - 30 * DAY_MS
    );
    const run = reservations.filter((reservation) => reservation.runId === request.runId);
    const source24h = last24h.filter(
      (reservation) => reservation.sourceId === request.sourceId
    );
    const violations: UsageViolation[] = [];

    this.checkMinutes(
      violations,
      "item",
      this.policy.maxItemMinutes,
      request.itemSeconds ?? request.audioSeconds
    );
    this.checkMinutes(
      violations,
      "run",
      this.policy.maxRunMinutes,
      sum(run, "audioSeconds") + request.audioSeconds
    );
    this.checkMinutes(
      violations,
      "source_24h",
      this.policy.maxSourceMinutes24h,
      sum(source24h, "audioSeconds") + request.audioSeconds
    );
    this.checkMinutes(
      violations,
      "total_30d",
      this.policy.maxTotalMinutes30d,
      sum(last30d, "audioSeconds") + request.audioSeconds
    );
    if (this.policy.maxTotalUsd30d > 0) {
      const projected = sum(last30d, "estimatedUsd") + estimatedUsd;
      if (projected > this.policy.maxTotalUsd30d + Number.EPSILON) {
        violations.push({
          scope: "usd_30d",
          limit: this.policy.maxTotalUsd30d,
          projected: round(projected),
          unit: "usd",
        });
      }
    }

    return {
      allowed: this.policy.enforcement !== "enforce" || violations.length === 0,
      enforced: this.policy.enforcement === "enforce",
      estimatedUsd,
      violations,
    };
  }

  private checkMinutes(
    violations: UsageViolation[],
    scope: Exclude<UsageScope, "usd_30d">,
    limitMinutes: number,
    projectedSeconds: number
  ): void {
    if (limitMinutes <= 0) return;
    const projectedMinutes = projectedSeconds / 60;
    if (projectedMinutes > limitMinutes + Number.EPSILON) {
      violations.push({
        scope,
        limit: limitMinutes,
        projected: round(projectedMinutes),
        unit: "minutes",
      });
    }
  }

  private validateRequest(request: UsageRequest): void {
    for (const [name, value] of Object.entries({
      runId: request.runId,
      sourceId: request.sourceId,
      itemId: request.itemId,
    })) {
      if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) {
        throw new Error(`Invalid usage ${name}`);
      }
    }
    if (!Number.isFinite(request.audioSeconds) || request.audioSeconds <= 0) {
      throw new Error("Usage audioSeconds must be positive");
    }
    if (
      request.itemSeconds !== undefined
      && (!Number.isFinite(request.itemSeconds) || request.itemSeconds <= 0)
    ) {
      throw new Error("Usage itemSeconds must be positive");
    }
  }

  private async readState(now: Date): Promise<UsageLedgerState> {
    try {
      const raw = await fs.readFile(this.ledgerPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<UsageLedgerState>;
      if (
        parsed.version !== 1 ||
        typeof parsed.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(parsed.updatedAt)) ||
        !Array.isArray(parsed.reservations) ||
        !parsed.reservations.every(isUsageReservation)
      ) {
        throw new Error("Unsupported usage ledger format");
      }
      return parsed as UsageLedgerState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState(now);
      throw new Error(
        `Usage ledger unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async writeState(state: UsageLedgerState, now: Date): Promise<void> {
    const cutoff = now.getTime() - RETENTION_MS;
    state.reservations = state.reservations.filter(
      (reservation) => Date.parse(reservation.reservedAt) >= cutoff
    );
    state.updatedAt = now.toISOString();
    await writeJson(this.ledgerPath, state);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await ensureDir(this.usageDir);
    const startedAt = Date.now();
    while (true) {
      try {
        await fs.mkdir(this.lockPath);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const stat = await fs.stat(this.lockPath).catch(() => undefined);
        if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          await fs.rm(this.lockPath, { recursive: true, force: true });
          continue;
        }
        if (Date.now() - startedAt >= LOCK_WAIT_MS) {
          throw new Error("Usage ledger lock timeout");
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    try {
      return await operation();
    } finally {
      await fs.rm(this.lockPath, { recursive: true, force: true });
    }
  }
}

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StoredTranscript } from "../transcripts/store.js";
import { canonicalJson } from "../transcripts/store.js";
import { transcriptionStatusEvent } from "./transcriptionProfile.js";

export type IntakeStatus =
  | "held"
  | "accepted"
  | "fetching"
  | "ready"
  | "running"
  | "completed"
  | "failed";

export type IntakeRequestV1 = {
  schemaVersion: "media2text.intake.v1";
  eventId: string;
  idempotencyKey: string;
  correlationId?: string;
  source: {
    authority: string;
    itemId: string;
    collectionId?: string;
    artifactRevision: string;
  };
  artifact: {
    url: string;
    sha256: string;
    bytes: number;
    contentType: string;
    durationSeconds?: number;
    filename?: string;
  };
  callback?: {
    url: string;
    authentication: "hmac-sha256-v1";
  };
  title?: string;
};

export type IntakeRecord = {
  intakeId: string;
  request: IntakeRequestV1;
  requestSha256: string;
  status: IntakeStatus;
  attemptCount: number;
  localPath?: string;
  runId?: string;
  transcriptId?: string;
  transcriptRecordSha256?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
};

export type OutboxRecord = {
  eventId: string;
  eventType: "transcript.ready";
  aggregateId: string;
  payload: TranscriptReadyEventV1;
  status: "pending" | "delivering" | "delivered" | "dead";
  attemptCount: number;
  nextAttemptAt: string;
  deliveredAt?: string;
  lastError?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type IntakeStatusOutboxRecord = {
  eventId: string;
  intakeId: string;
  sourceAuthority: string;
  sequence: number;
  callbackUrl: string;
  payload: ReturnType<typeof transcriptionStatusEvent>;
  status: "pending" | "delivering" | "delivered" | "dead";
  attemptCount: number;
  nextAttemptAt: string;
  deliveredAt?: string;
  lastError?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type TranscriptReadyEventV1 = {
  schemaVersion: "media2text.transcript-ready.v1";
  eventType: "transcript.ready";
  eventId: string;
  idempotencyKey: string;
  occurredAt: string;
  correlation: {
    runId: string;
    intakeId?: string;
  };
  source: StoredTranscript["record"]["source"];
  transcript: {
    transcriptId: string;
    recordSha256: string;
    recordBytes: number;
    schemaVersion: "media2text.transcript.v1";
    href: string;
  };
};

type IntakeRow = {
  intake_id: string;
  request_json: string;
  request_sha256: string;
  status: IntakeStatus;
  attempt_count: number;
  local_path: string | null;
  run_id: string | null;
  transcript_id: string | null;
  transcript_record_sha256: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
};

type OutboxRow = {
  event_id: string;
  event_type: "transcript.ready";
  aggregate_id: string;
  payload_json: string;
  status: OutboxRecord["status"];
  attempt_count: number;
  next_attempt_at: string;
  delivered_at: string | null;
  last_error: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type IntakeStatusOutboxRow = {
  event_id: string;
  intake_id: string;
  source_authority: string;
  event_sequence: number;
  callback_url: string;
  payload_json: string;
  status: IntakeStatusOutboxRecord["status"];
  attempt_count: number;
  next_attempt_at: string;
  delivered_at: string | null;
  last_error: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export class IntakeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeConflictError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function storedSourceItemId(request: IntakeRequestV1): string {
  if (!request.source.collectionId) return request.source.itemId;
  return `collection:${sha256(canonicalJson({
    collectionId: request.source.collectionId,
    itemId: request.source.itemId,
  }))}`;
}

function mapIntake(row: IntakeRow): IntakeRecord {
  return {
    intakeId: row.intake_id,
    request: JSON.parse(row.request_json) as IntakeRequestV1,
    requestSha256: row.request_sha256,
    status: row.status,
    attemptCount: row.attempt_count,
    localPath: row.local_path ?? undefined,
    runId: row.run_id ?? undefined,
    transcriptId: row.transcript_id ?? undefined,
    transcriptRecordSha256: row.transcript_record_sha256 ?? undefined,
    lastErrorCode: row.last_error_code ?? undefined,
    lastErrorMessage: row.last_error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
  };
}

function mapOutbox(row: OutboxRow): OutboxRecord {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    aggregateId: row.aggregate_id,
    payload: JSON.parse(row.payload_json) as TranscriptReadyEventV1,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    deliveredAt: row.delivered_at ?? undefined,
    lastError: row.last_error ?? undefined,
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIntakeStatusOutbox(row: IntakeStatusOutboxRow): IntakeStatusOutboxRecord {
  return {
    eventId: row.event_id,
    intakeId: row.intake_id,
    sourceAuthority: row.source_authority,
    sequence: row.event_sequence,
    callbackUrl: row.callback_url,
    payload: JSON.parse(row.payload_json) as ReturnType<typeof transcriptionStatusEvent>,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    deliveredAt: row.delivered_at ?? undefined,
    lastError: row.last_error ?? undefined,
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MediaJobStore {
  readonly dbPath: string;
  private db: DatabaseSync;

  constructor(outputDir: string) {
    this.dbPath = join(outputDir, "_jobs", "media2text.sqlite");
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA synchronous=FULL");
    this.db.exec("PRAGMA busy_timeout=5000");
    this.db.exec("PRAGMA foreign_keys=ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS intakes (
        intake_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        source_authority TEXT NOT NULL,
        source_item_id TEXT NOT NULL,
        artifact_revision TEXT NOT NULL,
        request_json TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('held','accepted','fetching','ready','running','completed','failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        local_path TEXT,
        run_id TEXT,
        transcript_id TEXT,
        transcript_record_sha256 TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_authority, source_item_id, artifact_revision)
      );
      CREATE INDEX IF NOT EXISTS idx_intakes_work
        ON intakes(status, lease_expires_at, created_at);

      CREATE TABLE IF NOT EXISTS outbox (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL CHECK (event_type = 'transcript.ready'),
        aggregate_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','delivering','delivered','dead')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        delivered_at TEXT,
        last_error TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_delivery
        ON outbox(status, next_attempt_at, lease_expires_at);

      CREATE TABLE IF NOT EXISTS intake_status_outbox (
        event_id TEXT PRIMARY KEY,
        intake_id TEXT NOT NULL,
        source_authority TEXT NOT NULL,
        event_sequence INTEGER NOT NULL DEFAULT 0,
        callback_url TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','delivering','delivered','dead')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        delivered_at TEXT,
        last_error TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(intake_id) REFERENCES intakes(intake_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_intake_status_outbox_delivery
        ON intake_status_outbox(status, next_attempt_at, lease_expires_at);
    `);

    const statusOutboxColumns = this.db
      .prepare("PRAGMA table_info(intake_status_outbox)")
      .all() as unknown as Array<{ name: string }>;
    if (!statusOutboxColumns.some((column) => column.name === "event_sequence")) {
      this.db.exec(
        "ALTER TABLE intake_status_outbox ADD COLUMN event_sequence INTEGER NOT NULL DEFAULT 0"
      );
    }
  }

  createIntake(
    request: IntakeRequestV1,
    now = new Date().toISOString(),
    options?: { status?: "held" | "accepted"; localPath?: string }
  ): {
    record: IntakeRecord;
    deduplicated: boolean;
  } {
    const requestJson = canonicalJson(request);
    const requestSha256 = sha256(requestJson);
    const identity = canonicalJson({
      authority: request.source.authority,
      collectionId: request.source.collectionId,
      itemId: request.source.itemId,
      artifactRevision: request.source.artifactRevision,
    });
    const intakeId = `int_${sha256(identity)}`;
    const sourceItemId = storedSourceItemId(request);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db
        .prepare(
          `SELECT * FROM intakes
           WHERE idempotency_key = ? OR
             (source_authority = ? AND source_item_id = ? AND artifact_revision = ?)
           LIMIT 1`
        )
        .get(
          request.idempotencyKey,
          request.source.authority,
          sourceItemId,
          request.source.artifactRevision
        ) as IntakeRow | undefined;
      if (existing) {
        if (existing.request_sha256 !== requestSha256) {
          throw new IntakeConflictError(
            "Idempotency key or artifact revision already exists with a different request"
          );
        }
        this.db.exec("COMMIT");
        return { record: mapIntake(existing), deduplicated: true };
      }

      this.db
        .prepare(
          `INSERT INTO intakes (
             intake_id, idempotency_key, source_authority, source_item_id,
             artifact_revision, request_json, request_sha256, status,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          intakeId,
          request.idempotencyKey,
          request.source.authority,
          sourceItemId,
          request.source.artifactRevision,
          requestJson,
          requestSha256,
          options?.status ?? "accepted",
          now,
          now
        );
      if (options?.localPath) {
        this.db
          .prepare("UPDATE intakes SET local_path = ? WHERE intake_id = ?")
          .run(options.localPath, intakeId);
      }
      const row = this.db
        .prepare("SELECT * FROM intakes WHERE intake_id = ?")
        .get(intakeId) as IntakeRow;
      this.enqueueIntakeStatusRecord(mapIntake(row), now);
      this.db.exec("COMMIT");
      return { record: mapIntake(row), deduplicated: false };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getIntake(intakeId: string): IntakeRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM intakes WHERE intake_id = ?")
      .get(intakeId) as IntakeRow | undefined;
    return row ? mapIntake(row) : undefined;
  }

  getIntakeBySource(
    authority: string,
    itemId: string,
    collectionId?: string
  ): IntakeRecord | undefined {
    const sourceItemId = collectionId
      ? `collection:${sha256(canonicalJson({ collectionId, itemId }))}`
      : itemId;
    const row = this.db
      .prepare(
        `SELECT * FROM intakes WHERE source_authority = ? AND source_item_id = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(authority, sourceItemId) as IntakeRow | undefined;
    return row ? mapIntake(row) : undefined;
  }

  listIntakes(limit = 100): IntakeRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM intakes ORDER BY created_at DESC LIMIT ?")
      .all(Math.max(1, Math.min(500, Math.trunc(limit)))) as unknown as IntakeRow[];
    return rows.map(mapIntake);
  }

  leaseNextIntake(owner = randomUUID(), leaseMs = 300_000): IntakeRecord | undefined {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + leaseMs).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          `SELECT * FROM intakes
           WHERE status IN ('accepted','ready')
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
           ORDER BY created_at ASC LIMIT 1`
        )
        .get(now) as IntakeRow | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        return undefined;
      }
      const nextStatus = row.status === "accepted" ? "fetching" : "running";
      this.db
        .prepare(
          `UPDATE intakes SET status = ?, lease_owner = ?, lease_expires_at = ?,
             attempt_count = attempt_count + 1, updated_at = ? WHERE intake_id = ?`
        )
        .run(nextStatus, owner, expiresAt, now, row.intake_id);
      const leased = this.db
        .prepare("SELECT * FROM intakes WHERE intake_id = ?")
        .get(row.intake_id) as IntakeRow;
      this.enqueueIntakeStatusRecord(mapIntake(leased), now);
      this.db.exec("COMMIT");
      return mapIntake(leased);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  renewIntakeLease(intakeId: string, owner: string, leaseMs = 300_000): boolean {
    const result = this.db
      .prepare(
        `UPDATE intakes SET lease_expires_at = ?, updated_at = ?
         WHERE intake_id = ? AND lease_owner = ? AND status IN ('fetching','running')`
      )
      .run(
        new Date(Date.now() + leaseMs).toISOString(),
        new Date().toISOString(),
        intakeId,
        owner
      );
    return Number(result.changes) === 1;
  }

  markIntakeReady(intakeId: string, owner: string, localPath: string): void {
    this.transitionIntake(intakeId, owner, "fetching", "ready", {
      localPath,
    });
  }

  markIntakeRun(intakeId: string, owner: string, runId: string): void {
    const result = this.db
      .prepare(
        `UPDATE intakes SET run_id = ?, updated_at = ?
         WHERE intake_id = ? AND lease_owner = ? AND status = 'running'`
      )
      .run(runId, new Date().toISOString(), intakeId, owner);
    if (Number(result.changes) !== 1) throw new Error("Intake lease lost before run start");
  }

  activateHeldIntake(
    intakeId: string,
    owner: string,
    runId: string,
    leaseMs = 300_000
  ): IntakeRecord {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE intakes SET status = 'running', run_id = ?, lease_owner = ?,
           lease_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?,
           last_error_code = NULL, last_error_message = NULL
         WHERE intake_id = ? AND status = 'held'`
      )
      .run(
        runId,
        owner,
        new Date(Date.now() + leaseMs).toISOString(),
        now,
        intakeId
      );
    if (Number(result.changes) !== 1) throw new Error("Intake is not available for activation");
    return this.getIntake(intakeId)!;
  }

  holdFailedIntake(intakeId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE intakes SET status = 'held', lease_owner = NULL, lease_expires_at = NULL,
           updated_at = ?, last_error_code = NULL, last_error_message = NULL
         WHERE intake_id = ? AND status = 'failed'`
      )
      .run(new Date().toISOString(), intakeId);
    return Number(result.changes) === 1;
  }

  markIntakeCompleted(
    intakeId: string,
    owner: string,
    transcriptId: string,
    transcriptRecordSha256: string
  ): void {
    this.transitionIntake(intakeId, owner, "running", "completed", {
      transcriptId,
      transcriptRecordSha256,
    });
  }

  markIntakeFailed(
    intakeId: string,
    owner: string,
    from: "fetching" | "running",
    code: string,
    message: string
  ): void {
    this.transitionIntake(intakeId, owner, from, "failed", {
      errorCode: code,
      errorMessage: message.slice(0, 1000),
    });
  }

  requeueIntakeFetch(
    intakeId: string,
    owner: string,
    code: string,
    message: string,
    retryAt: Date
  ): void {
    const result = this.db
      .prepare(
        `UPDATE intakes SET status = 'accepted', last_error_code = ?,
           last_error_message = ?, lease_owner = NULL, lease_expires_at = ?, updated_at = ?
         WHERE intake_id = ? AND lease_owner = ? AND status = 'fetching'`
      )
      .run(
        code,
        message.slice(0, 1000),
        retryAt.toISOString(),
        new Date().toISOString(),
        intakeId,
        owner
      );
    if (Number(result.changes) !== 1) throw new Error("Intake fetch lease lost");
  }

  private transitionIntake(
    intakeId: string,
    owner: string,
    from: IntakeStatus,
    to: IntakeStatus,
    values: {
      localPath?: string;
      transcriptId?: string;
      transcriptRecordSha256?: string;
      errorCode?: string;
      errorMessage?: string;
    }
  ): void {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare(
          `UPDATE intakes SET status = ?, local_path = COALESCE(?, local_path),
             transcript_id = COALESCE(?, transcript_id),
             transcript_record_sha256 = COALESCE(?, transcript_record_sha256),
             last_error_code = ?, last_error_message = ?, lease_owner = NULL,
             lease_expires_at = NULL, updated_at = ?
           WHERE intake_id = ? AND lease_owner = ? AND status = ?`
        )
        .run(
          to,
          values.localPath ?? null,
          values.transcriptId ?? null,
          values.transcriptRecordSha256 ?? null,
          values.errorCode ?? null,
          values.errorMessage ?? null,
          now,
          intakeId,
          owner,
          from
        );
      if (Number(result.changes) !== 1) {
        throw new Error(`Intake transition ${from} -> ${to} lost its lease`);
      }
      const row = this.db
        .prepare("SELECT * FROM intakes WHERE intake_id = ?")
        .get(intakeId) as IntakeRow;
      this.enqueueIntakeStatusRecord(mapIntake(row), now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  recoverExpiredIntakes(now = new Date().toISOString()): number {
    const result = this.db
      .prepare(
        `UPDATE intakes
         SET status = CASE WHEN status = 'fetching' THEN 'accepted' ELSE 'ready' END,
             lease_owner = NULL, lease_expires_at = NULL, updated_at = ?,
             last_error_code = 'interrupted',
             last_error_message = 'Worker interrupted before completion; safely requeued'
         WHERE status IN ('fetching','running')
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`
      )
      .run(now, now);
    return Number(result.changes);
  }

  private enqueueIntakeStatusRecord(record: IntakeRecord, now: string): void {
    if (!record.request.callback || !record.request.source.collectionId) return;
    const event = transcriptionStatusEvent(record);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO intake_status_outbox (
           event_id, intake_id, source_authority, event_sequence, callback_url, payload_json,
           status, attempt_count, next_attempt_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`
      )
      .run(
        event.eventId,
        record.intakeId,
        record.request.source.authority,
        event.status === "accepted" ? 0 : event.status === "processing" ? 1 : 2,
        record.request.callback.url,
        canonicalJson(event),
        now,
        now,
        now
      );
  }

  getIntakeStatusOutbox(eventId: string): IntakeStatusOutboxRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM intake_status_outbox WHERE event_id = ?")
      .get(eventId) as IntakeStatusOutboxRow | undefined;
    return row ? mapIntakeStatusOutbox(row) : undefined;
  }

  listIntakeStatusOutbox(intakeId: string): IntakeStatusOutboxRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM intake_status_outbox WHERE intake_id = ? ORDER BY created_at ASC")
      .all(intakeId) as unknown as IntakeStatusOutboxRow[];
    return rows.map(mapIntakeStatusOutbox);
  }

  leaseNextIntakeStatusOutbox(
    owner = randomUUID(),
    leaseMs = 60_000
  ): IntakeStatusOutboxRecord | undefined {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + leaseMs).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          `SELECT candidate.* FROM intake_status_outbox AS candidate
           WHERE candidate.status = 'pending' AND candidate.next_attempt_at <= ?
             AND (candidate.lease_expires_at IS NULL OR candidate.lease_expires_at <= ?)
             AND NOT EXISTS (
               SELECT 1 FROM intake_status_outbox AS earlier
               WHERE earlier.intake_id = candidate.intake_id
                 AND earlier.event_sequence < candidate.event_sequence
                 AND earlier.status IN ('pending','delivering')
             )
           ORDER BY candidate.created_at ASC, candidate.event_sequence ASC LIMIT 1`
        )
        .get(now, now) as IntakeStatusOutboxRow | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        return undefined;
      }
      this.db
        .prepare(
          `UPDATE intake_status_outbox
           SET status = 'delivering', lease_owner = ?, lease_expires_at = ?,
             attempt_count = attempt_count + 1, updated_at = ?
           WHERE event_id = ?`
        )
        .run(owner, expiresAt, now, row.event_id);
      const leased = this.db
        .prepare("SELECT * FROM intake_status_outbox WHERE event_id = ?")
        .get(row.event_id) as IntakeStatusOutboxRow;
      this.db.exec("COMMIT");
      return mapIntakeStatusOutbox(leased);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  markIntakeStatusOutboxDelivered(eventId: string, owner: string): void {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE intake_status_outbox
         SET status = 'delivered', delivered_at = ?, updated_at = ?,
           lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
         WHERE event_id = ? AND lease_owner = ? AND status = 'delivering'`
      )
      .run(now, now, eventId, owner);
    if (Number(result.changes) !== 1) throw new Error("Intake status outbox lease lost");
  }

  markIntakeStatusOutboxFailed(
    eventId: string,
    owner: string,
    error: string,
    options?: { dead?: boolean; delayMs?: number }
  ): void {
    const now = new Date().toISOString();
    const nextAttemptAt = new Date(Date.now() + (options?.delayMs ?? 60_000)).toISOString();
    const result = this.db
      .prepare(
        `UPDATE intake_status_outbox
         SET status = ?, next_attempt_at = ?, last_error = ?, updated_at = ?,
           lease_owner = NULL, lease_expires_at = NULL
         WHERE event_id = ? AND lease_owner = ? AND status = 'delivering'`
      )
      .run(
        options?.dead ? "dead" : "pending",
        nextAttemptAt,
        error.slice(0, 1000),
        now,
        eventId,
        owner
      );
    if (Number(result.changes) !== 1) throw new Error("Intake status outbox lease lost");
  }

  recoverExpiredIntakeStatusOutbox(now = new Date().toISOString()): number {
    const result = this.db
      .prepare(
        `UPDATE intake_status_outbox
         SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
           next_attempt_at = ?, updated_at = ?, last_error = 'Delivery interrupted; requeued'
         WHERE status = 'delivering' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`
      )
      .run(now, now, now);
    return Number(result.changes);
  }

  enqueueTranscriptReady(
    stored: StoredTranscript,
    now = new Date().toISOString()
  ): OutboxRecord {
    const eventId = `evt_${sha256(`transcript.ready:${stored.record.transcriptId}`)}`;
    const event: TranscriptReadyEventV1 = {
      schemaVersion: "media2text.transcript-ready.v1",
      eventType: "transcript.ready",
      eventId,
      idempotencyKey: `transcript.ready:${stored.record.transcriptId}`,
      occurredAt: stored.record.createdAt,
      correlation: stored.record.correlation,
      source: stored.record.source,
      transcript: {
        transcriptId: stored.record.transcriptId,
        recordSha256: stored.recordSha256,
        recordBytes: stored.bytes,
        schemaVersion: "media2text.transcript.v1",
        href: `/v1/transcripts/${stored.record.transcriptId}`,
      },
    };
    this.db
      .prepare(
        `INSERT OR IGNORE INTO outbox (
           event_id, event_type, aggregate_id, payload_json, status,
           attempt_count, next_attempt_at, created_at, updated_at
         ) VALUES (?, 'transcript.ready', ?, ?, 'pending', 0, ?, ?, ?)`
      )
      .run(
        eventId,
        stored.record.transcriptId,
        canonicalJson(event),
        now,
        now,
        now
      );
    return this.getOutbox(eventId)!;
  }

  getOutbox(eventId: string): OutboxRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM outbox WHERE event_id = ?")
      .get(eventId) as OutboxRow | undefined;
    return row ? mapOutbox(row) : undefined;
  }

  leaseNextOutbox(owner = randomUUID(), leaseMs = 60_000): OutboxRecord | undefined {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + leaseMs).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          `SELECT * FROM outbox
           WHERE status = 'pending' AND next_attempt_at <= ?
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
           ORDER BY created_at ASC LIMIT 1`
        )
        .get(now, now) as OutboxRow | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        return undefined;
      }
      this.db
        .prepare(
          `UPDATE outbox SET status = 'delivering', lease_owner = ?, lease_expires_at = ?,
             attempt_count = attempt_count + 1, updated_at = ? WHERE event_id = ?`
        )
        .run(owner, expiresAt, now, row.event_id);
      const leased = this.db
        .prepare("SELECT * FROM outbox WHERE event_id = ?")
        .get(row.event_id) as OutboxRow;
      this.db.exec("COMMIT");
      return mapOutbox(leased);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  markOutboxDelivered(eventId: string, owner: string): void {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE outbox SET status = 'delivered', delivered_at = ?, updated_at = ?,
           lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
         WHERE event_id = ? AND lease_owner = ? AND status = 'delivering'`
      )
      .run(now, now, eventId, owner);
    if (Number(result.changes) !== 1) throw new Error("Outbox delivery lease lost");
  }

  markOutboxFailed(
    eventId: string,
    owner: string,
    error: string,
    options?: { dead?: boolean; delayMs?: number }
  ): void {
    const now = new Date().toISOString();
    const nextAttemptAt = new Date(Date.now() + (options?.delayMs ?? 60_000)).toISOString();
    const result = this.db
      .prepare(
        `UPDATE outbox SET status = ?, next_attempt_at = ?, last_error = ?, updated_at = ?,
           lease_owner = NULL, lease_expires_at = NULL
         WHERE event_id = ? AND lease_owner = ? AND status = 'delivering'`
      )
      .run(
        options?.dead ? "dead" : "pending",
        nextAttemptAt,
        error.slice(0, 1000),
        now,
        eventId,
        owner
      );
    if (Number(result.changes) !== 1) throw new Error("Outbox delivery lease lost");
  }

  recoverExpiredOutbox(now = new Date().toISOString()): number {
    const result = this.db
      .prepare(
        `UPDATE outbox SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
           next_attempt_at = ?, updated_at = ?, last_error = 'Delivery interrupted; requeued'
         WHERE status = 'delivering' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`
      )
      .run(now, now, now);
    return Number(result.changes);
  }

  statusCounts(): {
    intakes: Record<IntakeStatus, number>;
    outbox: Record<OutboxRecord["status"], number>;
    intakeStatusOutbox: Record<IntakeStatusOutboxRecord["status"], number>;
  } {
    const intakes: Record<IntakeStatus, number> = {
      held: 0,
      accepted: 0,
      fetching: 0,
      ready: 0,
      running: 0,
      completed: 0,
      failed: 0,
    };
    const outbox: Record<OutboxRecord["status"], number> = {
      pending: 0,
      delivering: 0,
      delivered: 0,
      dead: 0,
    };
    const intakeStatusOutbox: Record<IntakeStatusOutboxRecord["status"], number> = {
      pending: 0,
      delivering: 0,
      delivered: 0,
      dead: 0,
    };
    const intakeRows = this.db
      .prepare("SELECT status, COUNT(*) AS count FROM intakes GROUP BY status")
      .all() as unknown as Array<{ status: IntakeStatus; count: number }>;
    const outboxRows = this.db
      .prepare("SELECT status, COUNT(*) AS count FROM outbox GROUP BY status")
      .all() as unknown as Array<{ status: OutboxRecord["status"]; count: number }>;
    const intakeStatusRows = this.db
      .prepare("SELECT status, COUNT(*) AS count FROM intake_status_outbox GROUP BY status")
      .all() as unknown as Array<{
        status: IntakeStatusOutboxRecord["status"];
        count: number;
      }>;
    for (const row of intakeRows) intakes[row.status] = Number(row.count);
    for (const row of outboxRows) outbox[row.status] = Number(row.count);
    for (const row of intakeStatusRows) intakeStatusOutbox[row.status] = Number(row.count);
    return { intakes, outbox, intakeStatusOutbox };
  }

  pruneTerminal(options?: {
    nowMs?: number;
    intakeRetentionDays?: number;
    outboxRetentionDays?: number;
  }): { intakesDeleted: number; outboxDeleted: number; intakeStatusOutboxDeleted: number } {
    const nowMs = options?.nowMs ?? Date.now();
    const intakeDays = Math.max(1, options?.intakeRetentionDays ?? 365);
    const outboxDays = Math.max(1, options?.outboxRetentionDays ?? 365);
    const intakeCutoff = new Date(nowMs - intakeDays * 86_400_000).toISOString();
    const outboxCutoff = new Date(nowMs - outboxDays * 86_400_000).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const intakeStatusOutbox = this.db
        .prepare(
          "DELETE FROM intake_status_outbox WHERE status IN ('delivered','dead') AND updated_at < ?"
        )
        .run(outboxCutoff);
      const outbox = this.db
        .prepare(
          "DELETE FROM outbox WHERE status IN ('delivered','dead') AND updated_at < ?"
        )
        .run(outboxCutoff);
      const intakes = this.db
        .prepare(
          `DELETE FROM intakes
           WHERE status IN ('completed','failed') AND updated_at < ?
             AND NOT EXISTS (
               SELECT 1 FROM intake_status_outbox
               WHERE intake_status_outbox.intake_id = intakes.intake_id
             )`
        )
        .run(intakeCutoff);
      this.db.exec("COMMIT");
      return {
        intakesDeleted: Number(intakes.changes),
        outboxDeleted: Number(outbox.changes),
        intakeStatusOutboxDeleted: Number(intakeStatusOutbox.changes),
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { getBuildVersion } from "../utils/version.js";
import type { IntakeRecord, IntakeRequestV1, IntakeStatus } from "./store.js";

const identifier = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:@/-]+$/);
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);

const exactOrigin = z.string().url().transform((value, context) => {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "must be an exact HTTPS origin" });
    return z.NEVER;
  }
  return url.origin;
});

const producerProfileSchema = z.object({
  id: identifier,
  authority: identifier,
  intakeBearer: z.string().min(32).max(2048),
  artifactBearer: z.string().min(32).max(2048),
  statusHmacSecret: z.string().min(32).max(2048),
  artifactOrigins: z.array(exactOrigin).min(1),
  callbackOrigins: z.array(exactOrigin).min(1),
}).strict();

export type TranscriptionProducerProfile = z.infer<typeof producerProfileSchema>;

export const transcriptionIntakeRequestSchema = z.object({
  schemaVersion: z.literal("transcription.intake.v1"),
  eventId: z.string().uuid(),
  idempotencyKey: identifier,
  correlationId: identifier.optional(),
  source: z.object({
    authority: identifier,
    collectionId: identifier,
    itemId: identifier,
    artifactRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }).strict(),
  artifact: z.object({
    url: z.string().url().refine(noUrlCredentials, "must not contain credentials, query, or fragment"),
    accessProfile: z.literal("bearer"),
    sha256: sha256Hex,
    bytes: z.number().int().positive().max(10_737_418_240),
    contentType: z.string().regex(/^audio\/[A-Za-z0-9.+-]+$/),
    filename: z.string().min(1).max(255),
    durationSeconds: z.number().positive(),
  }).strict(),
  callback: z.object({
    url: z.string().url().refine(noUrlCredentials, "must not contain credentials, query, or fragment"),
    authentication: z.literal("hmac-sha256-v1"),
  }).strict(),
  title: z.string().min(1).max(500),
  createdAt: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((value, context) => {
  if (value.source.artifactRevision !== `sha256:${value.artifact.sha256}`) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["source", "artifactRevision"],
      message: "must equal sha256:<artifact.sha256>",
    });
  }
});

export type TranscriptionIntakeRequest = z.infer<typeof transcriptionIntakeRequestSchema>;

export function validateTranscriptionProfiles(): void {
  loadTranscriptionProfiles();
}

export function loadTranscriptionProfiles(): TranscriptionProducerProfile[] {
  const raw = process.env.Y2T_TRANSCRIPTION_INTAKE_PROFILES_JSON?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Y2T_TRANSCRIPTION_INTAKE_PROFILES_JSON must be valid JSON");
  }
  const profiles = z.array(producerProfileSchema).parse(parsed);
  const ids = new Set<string>();
  const authorities = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) throw new Error(`Duplicate transcription intake profile id: ${profile.id}`);
    if (authorities.has(profile.authority)) {
      throw new Error(`Duplicate transcription intake profile authority: ${profile.authority}`);
    }
    ids.add(profile.id);
    authorities.add(profile.authority);
  }
  return profiles;
}

export function transcriptionProfileForRequest(
  req: IncomingMessage
): TranscriptionProducerProfile | undefined {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return undefined;
  const actual = authorization.slice("Bearer ".length).trim();
  if (!actual || actual.length > 2048) return undefined;
  return loadTranscriptionProfiles().find((profile) => constantTimeEqual(actual, profile.intakeBearer));
}

export function transcriptionProfileForAuthority(
  authority: string
): TranscriptionProducerProfile | undefined {
  return loadTranscriptionProfiles().find((profile) => profile.authority === authority);
}

export function assertTranscriptionProfileRequest(
  profile: TranscriptionProducerProfile,
  request: TranscriptionIntakeRequest
): void {
  if (request.source.authority !== profile.authority) {
    throw new Error("intake credential is not scoped to this source authority");
  }
  const artifactOrigin = new URL(request.artifact.url).origin;
  if (!profile.artifactOrigins.includes(artifactOrigin)) {
    throw new Error("artifact origin is not allowed for this producer profile");
  }
  const callbackOrigin = new URL(request.callback.url).origin;
  if (!profile.callbackOrigins.includes(callbackOrigin)) {
    throw new Error("callback origin is not allowed for this producer profile");
  }
}

export function adaptTranscriptionIntake(request: TranscriptionIntakeRequest): IntakeRequestV1 {
  return {
    schemaVersion: "media2text.intake.v1",
    eventId: request.eventId,
    idempotencyKey: request.idempotencyKey,
    correlationId: request.correlationId,
    source: request.source,
    artifact: {
      url: request.artifact.url,
      sha256: request.artifact.sha256,
      bytes: request.artifact.bytes,
      contentType: request.artifact.contentType,
      durationSeconds: request.artifact.durationSeconds,
      filename: request.artifact.filename,
    },
    callback: request.callback,
    title: request.title,
  };
}

export async function transcriptionCapabilities() {
  return {
    schemaVersion: "transcription.intake-capabilities.v1" as const,
    provider: { name: "Media2Text", version: await getBuildVersion() },
    intakeContract: "transcription.intake.v1" as const,
    statusContract: "transcription.intake-status.v1" as const,
    statusPush: true as const,
    statusPull: true as const,
  };
}

export function publicTranscriptionStatus(record: IntakeRecord) {
  const status = externalStatus(record.status, record.attemptCount);
  return {
    schemaVersion: "transcription.intake-status.v1" as const,
    intakeId: record.intakeId,
    source: {
      authority: record.request.source.authority,
      collectionId: record.request.source.collectionId!,
      itemId: record.request.source.itemId,
      artifactRevision: record.request.source.artifactRevision,
    },
    status,
    occurredAt: record.updatedAt,
    ...(status === "transcribed"
      ? {
          transcriptId: record.transcriptId ?? null,
          recordSha256: record.transcriptRecordSha256 ?? null,
        }
      : {}),
    ...(status === "failed"
      ? { error: record.lastErrorCode ? { code: record.lastErrorCode } : null }
      : {}),
  };
}

export function transcriptionStatusEvent(record: IntakeRecord) {
  const status = publicTranscriptionStatus(record);
  const eventKey = `intake.status:${record.intakeId}:${status.status}`;
  return {
    ...status,
    eventId: deterministicUuid(eventKey),
    idempotencyKey: eventKey,
    eventType: "intake.status" as const,
  };
}

function externalStatus(status: IntakeStatus, attemptCount: number) {
  if (status === "completed") return "transcribed" as const;
  if (status === "failed") return "failed" as const;
  if (status === "accepted" && attemptCount === 0) return "accepted" as const;
  return "processing" as const;
}

function deterministicUuid(value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(value).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  const length = Math.max(a.length, b.length, 1);
  const paddedA = Buffer.alloc(length);
  const paddedB = Buffer.alloc(length);
  a.copy(paddedA);
  b.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB) && a.length === b.length;
}

function noUrlCredentials(value: string): boolean {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

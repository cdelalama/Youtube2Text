import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { SttProviderId } from "../config/schema.js";
import type { TranscriptJson } from "../transcription/types.js";
import { ensureDir } from "../utils/fs.js";

export const LEGACY_TRANSCRIPT_SCHEMA_VERSION = "media2text.transcript.v1" as const;
export const TRANSCRIPT_SCHEMA_VERSION = "media2text.transcript.v2" as const;

type TranscriptSourceBase = {
  kind: "youtube" | "upload" | "intake";
  authority: string;
  sourceItemId: string;
  sourceCollectionId?: string;
  canonicalUrl?: string;
  title: string;
  publishedAt?: string;
  artifactRevision: string;
};

export type TranscriptSourceV1 = TranscriptSourceBase;

export type TranscriptSourceV2 = TranscriptSourceBase & {
  createdAt: string | null;
  createdAtType: "recorded" | "published" | "unknown";
  createdAtSuppliedBy: string | null;
  createdAtUnavailableReason: string | null;
};

export type TranscriptRepresentationV1 = {
  format: "provider-json" | "text" | "markdown" | "jsonl" | "csv";
  relativePath: string;
  legacyRelativePath?: string;
  sha256: string;
  bytes: number;
};

export type TranscriptRepresentationV2 = TranscriptRepresentationV1 & {
  createdAt: string;
  generator: {
    name: "Media2Text";
    version: string;
  };
  derivedFrom: {
    sourceArtifactRevision: string;
    transcriptPayloadSha256: string;
  };
};

export type TranscriptRecordV1 = {
  schemaVersion: typeof LEGACY_TRANSCRIPT_SCHEMA_VERSION;
  transcriptId: string;
  createdAt: string;
  producer: {
    name: "Media2Text";
    technicalId: "youtube2text";
    version: string;
  };
  correlation: {
    runId: string;
    intakeId?: string;
  };
  source: TranscriptSourceV1;
  artifact: {
    sha256: string;
    bytes: number;
    durationSeconds: number;
    contentType: string;
  };
  transcription: {
    provider: SttProviderId;
    model: string;
    providerTranscriptId?: string;
    languageCode?: string;
    languageConfidence?: number;
    payloadSha256: string;
    payload: TranscriptJson;
  };
  representations: TranscriptRepresentationV1[];
};

export type TranscriptRecordV2 = {
  schemaVersion: typeof TRANSCRIPT_SCHEMA_VERSION;
  transcriptId: string;
  materializedAt: string;
  producer: {
    name: "Media2Text";
    technicalId: "youtube2text";
    version: string;
  };
  correlation: {
    runId: string;
    intakeId: string | null;
  };
  source: TranscriptSourceV2;
  artifact: {
    revision: string;
    sha256: string;
    bytes: number;
    durationSeconds: number;
    contentType: string;
  };
  transcription: {
    provider: SttProviderId;
    providerTranscriptId: string | null;
    providerTranscriptIdEvidence: string | null;
    providerTranscriptIdUnavailableReason: string | null;
    model: {
      name: string | null;
      nameEvidence: string | null;
      nameUnavailableReason: string | null;
      version: string | null;
      versionEvidence: string | null;
      versionUnavailableReason: string | null;
    };
    languageCode: string | null;
    languageConfidence: number | null;
    payloadSha256: string;
    payload: TranscriptJson;
  };
  representations: TranscriptRepresentationV2[];
};

export type TranscriptRecord = TranscriptRecordV1 | TranscriptRecordV2;

export type StoredTranscript = {
  record: TranscriptRecord;
  recordSha256: string;
  bytes: number;
  relativePath: string;
  created: boolean;
};

export type TranscriptWriteInput = {
  materializedAt: string;
  producerVersion: string;
  runId: string;
  intakeId?: string;
  source: Omit<TranscriptSourceV2, "artifactRevision">;
  audioPath: string;
  sourceArtifact?: {
    path: string;
    artifactRevision: string;
    contentType: string;
    durationSeconds?: number;
  };
  durationSeconds: number;
  contentType: string;
  provider: SttProviderId;
  model:
    | string
    | {
        name: string | null;
        nameEvidence: string | null;
        nameUnavailableReason: string | null;
      };
  transcript: TranscriptJson;
  languageCode?: string;
  languageConfidence?: number;
  representations: Array<{
    format: TranscriptRepresentationV1["format"];
    absolutePath: string;
    content: string;
  }>;
};

function normalizeForJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => normalizeForJson(item ?? null));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined && typeof item !== "function" && typeof item !== "symbol") {
        out[key] = normalizeForJson(item);
      }
    }
    return out;
  }
  return null;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(normalizeForJson(value))}\n`;
}

export function sha256Text(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    hash.update(buffer);
  }
  return { sha256: hash.digest("hex"), bytes };
}

export function transcriptMaterializedAt(record: TranscriptRecord): string {
  return record.schemaVersion === TRANSCRIPT_SCHEMA_VERSION
    ? record.materializedAt
    : record.createdAt;
}

function contentPath(outputDir: string, absolutePath: string): string {
  const rel = relative(outputDir, absolutePath);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) {
    throw new Error("Transcript representation path must be inside outputDir");
  }
  return rel.split(sep).join("/");
}

function recordIdentity(input: { source: TranscriptSourceV2; payloadSha256: string }): string {
  const identity = canonicalJson({
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    authority: input.source.authority,
    sourceCollectionId: input.source.sourceCollectionId ?? null,
    sourceItemId: input.source.sourceItemId,
    artifactRevision: input.source.artifactRevision,
    payloadSha256: input.payloadSha256,
  });
  return `trn_${sha256Text(identity)}`;
}

function representationFilename(format: TranscriptRepresentationV1["format"]): string {
  if (format === "provider-json") return "transcript.provider.json";
  if (format === "text") return "transcript.txt";
  if (format === "markdown") return "transcript.md";
  if (format === "jsonl") return "transcript.jsonl";
  return "transcript.csv";
}

async function writeImmutable(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  try {
    await fs.writeFile(path, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await fs.readFile(path, "utf8");
    if (existing !== content) throw new Error(`Immutable transcript representation collision at ${path}`);
  }
}

type ModelVersionProvenance = {
  version: string | null;
  versionEvidence: string | null;
  versionUnavailableReason: string | null;
};

function modelVersionProvenance(
  transcript: TranscriptJson,
  model: string | null
): ModelVersionProvenance {
  if (typeof transcript.provider_model_version === "string" && transcript.provider_model_version) {
    return {
      version: transcript.provider_model_version,
      versionEvidence: "provider-response.provider_model_version",
      versionUnavailableReason: null,
    };
  }
  const metadata = transcript.provider_metadata;
  if (metadata && typeof metadata === "object") {
    const modelInfo = (metadata as Record<string, unknown>).model_info;
    if (modelInfo && typeof modelInfo === "object") {
      const candidates: Array<{ id: string; name?: string; version: string }> = [];
      for (const [id, value] of Object.entries(modelInfo as Record<string, unknown>)) {
        if (!value || typeof value !== "object") continue;
        const item = value as Record<string, unknown>;
        if (
          typeof item.version === "string" &&
          (model === null || item.name === undefined || item.name === model)
        ) {
          candidates.push({
            id,
            name: typeof item.name === "string" ? item.name : undefined,
            version: item.version,
          });
        }
      }
      if (candidates.length === 1) {
        return {
          version: candidates[0]!.version,
          versionEvidence: `provider-response.provider_metadata.model_info.${candidates[0]!.id}.version`,
          versionUnavailableReason: null,
        };
      }
    }
  }
  return {
    version: null,
    versionEvidence: null,
    versionUnavailableReason: "provider response did not report one unambiguous model version",
  };
}

export class TranscriptStore {
  readonly rootDir: string;
  readonly legacyRootDir: string;

  constructor(private outputDir: string) {
    this.rootDir = join(outputDir, "_transcripts", "v2");
    this.legacyRootDir = join(outputDir, "_transcripts", "v1");
  }

  private pathFor(rootDir: string, transcriptId: string): string {
    if (!/^trn_[a-f0-9]{64}$/.test(transcriptId)) throw new Error("Invalid transcriptId");
    return join(rootDir, transcriptId.slice(4, 6), `${transcriptId}.json`);
  }

  async write(input: TranscriptWriteInput): Promise<StoredTranscript> {
    const artifactPath = input.sourceArtifact?.path ?? input.audioPath;
    const [artifact, producerJson] = await Promise.all([
      sha256File(artifactPath),
      Promise.resolve(canonicalJson(input.transcript)),
    ]);
    const calculatedArtifactRevision = `sha256:${artifact.sha256}`;
    if (input.sourceArtifact && input.sourceArtifact.artifactRevision !== calculatedArtifactRevision) {
      throw new Error(
        `Source artifact revision mismatch: expected ${input.sourceArtifact.artifactRevision}, got ${calculatedArtifactRevision}`
      );
    }
    const payloadSha256 = sha256Text(producerJson);
    const source: TranscriptSourceV2 = { ...input.source, artifactRevision: calculatedArtifactRevision };
    const transcriptId = recordIdentity({ source, payloadSha256 });
    const representationDir = join(this.rootDir, transcriptId.slice(4, 6), transcriptId);
    const representations = await Promise.all(
      input.representations.map(async (item): Promise<TranscriptRepresentationV2> => {
        const immutablePath = join(representationDir, representationFilename(item.format));
        await writeImmutable(immutablePath, item.content);
        return {
          format: item.format,
          relativePath: contentPath(this.outputDir, immutablePath),
          legacyRelativePath: contentPath(this.outputDir, item.absolutePath),
          sha256: sha256Text(item.content),
          bytes: Buffer.byteLength(item.content),
          createdAt: input.materializedAt,
          generator: { name: "Media2Text", version: input.producerVersion },
          derivedFrom: {
            sourceArtifactRevision: calculatedArtifactRevision,
            transcriptPayloadSha256: payloadSha256,
          },
        };
      })
    );
    const modelName =
      typeof input.model === "string"
        ? {
            name: input.model,
            nameEvidence: "media2text-config",
            nameUnavailableReason: null,
          }
        : input.model;
    const modelVersion = modelVersionProvenance(input.transcript, modelName.name);
    const explicitProviderTranscriptId = input.transcript.provider_transcript_id;
    const providerTranscriptId =
      typeof explicitProviderTranscriptId === "string"
        ? explicitProviderTranscriptId
        : input.provider === "assemblyai" && typeof input.transcript.id === "string"
          ? input.transcript.id
          : null;
    const record: TranscriptRecordV2 = {
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      transcriptId,
      materializedAt: input.materializedAt,
      producer: { name: "Media2Text", technicalId: "youtube2text", version: input.producerVersion },
      correlation: { runId: input.runId, intakeId: input.intakeId ?? null },
      source,
      artifact: {
        revision: calculatedArtifactRevision,
        ...artifact,
        durationSeconds: input.sourceArtifact?.durationSeconds ?? input.durationSeconds,
        contentType: input.sourceArtifact?.contentType ?? input.contentType,
      },
      transcription: {
        provider: input.provider,
        providerTranscriptId,
        providerTranscriptIdEvidence: providerTranscriptId
          ? input.provider === "assemblyai"
            ? "provider-response.id"
            : "provider-response.provider_transcript_id"
          : null,
        providerTranscriptIdUnavailableReason: providerTranscriptId
          ? null
          : "provider response did not report a durable transcript or request id",
        model: { ...modelName, ...modelVersion },
        languageCode: input.languageCode ?? null,
        languageConfidence: input.languageConfidence ?? null,
        payloadSha256,
        payload: input.transcript,
      },
      representations,
    };
    const path = this.pathFor(this.rootDir, transcriptId);
    await ensureDir(dirname(path));

    let bytes = canonicalJson(record);
    let created = true;
    try {
      await fs.writeFile(path, bytes, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      bytes = await fs.readFile(path, "utf8");
      const existing = JSON.parse(bytes) as TranscriptRecordV2;
      if (
        existing.transcriptId !== transcriptId ||
        existing.transcription?.payloadSha256 !== payloadSha256 ||
        existing.source?.artifactRevision !== source.artifactRevision
      ) {
        throw new Error(`Immutable transcript collision for ${transcriptId}`);
      }
      created = false;
      return {
        record: existing,
        recordSha256: sha256Text(bytes),
        bytes: Buffer.byteLength(bytes),
        relativePath: contentPath(this.outputDir, path),
        created,
      };
    }

    return {
      record,
      recordSha256: sha256Text(bytes),
      bytes: Buffer.byteLength(bytes),
      relativePath: contentPath(this.outputDir, path),
      created,
    };
  }

  async read(transcriptId: string): Promise<StoredTranscript | undefined> {
    for (const rootDir of [this.rootDir, this.legacyRootDir]) {
      let path: string;
      try {
        path = this.pathFor(rootDir, transcriptId);
      } catch {
        return undefined;
      }
      try {
        const bytes = await fs.readFile(path, "utf8");
        return {
          record: JSON.parse(bytes) as TranscriptRecord,
          recordSha256: sha256Text(bytes),
          bytes: Buffer.byteLength(bytes),
          relativePath: contentPath(this.outputDir, path),
          created: false,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return undefined;
  }

  private async idsIn(rootDir: string): Promise<string[]> {
    let prefixes: string[];
    try {
      prefixes = await fs.readdir(rootDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const ids: string[] = [];
    for (const prefix of prefixes.sort()) {
      const dir = join(rootDir, prefix);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && /^trn_[a-f0-9]{64}\.json$/.test(entry.name)) ids.push(entry.name.slice(0, -5));
      }
    }
    return ids;
  }

  async listAll(): Promise<StoredTranscript[]> {
    const ids = new Set([
      ...(await this.idsIn(this.rootDir)),
      ...(await this.idsIn(this.legacyRootDir)),
    ]);
    const records = (await Promise.all([...ids].map((id) => this.read(id)))).filter(
      (item): item is StoredTranscript => item !== undefined
    );
    return records.sort((a, b) => {
      const byTime = transcriptMaterializedAt(b.record).localeCompare(transcriptMaterializedAt(a.record));
      return byTime || b.record.transcriptId.localeCompare(a.record.transcriptId);
    });
  }

  async list(limit = 100): Promise<StoredTranscript[]> {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    return (await this.listAll()).slice(0, boundedLimit);
  }
}

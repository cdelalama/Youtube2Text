import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { SttProviderId } from "../config/schema.js";
import type { TranscriptJson } from "../transcription/types.js";
import { ensureDir } from "../utils/fs.js";

export const TRANSCRIPT_SCHEMA_VERSION = "media2text.transcript.v1" as const;

export type TranscriptSourceV1 = {
  kind: "youtube" | "upload" | "intake";
  authority: string;
  sourceItemId: string;
  sourceCollectionId?: string;
  canonicalUrl?: string;
  title: string;
  publishedAt?: string;
  artifactRevision: string;
};

export type TranscriptRepresentationV1 = {
  format: "provider-json" | "text" | "markdown" | "jsonl" | "csv";
  relativePath: string;
  legacyRelativePath?: string;
  sha256: string;
  bytes: number;
};

export type TranscriptRecordV1 = {
  schemaVersion: typeof TRANSCRIPT_SCHEMA_VERSION;
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

export type StoredTranscript = {
  record: TranscriptRecordV1;
  recordSha256: string;
  bytes: number;
  relativePath: string;
  created: boolean;
};

type TranscriptWriteInput = {
  createdAt: string;
  producerVersion: string;
  runId: string;
  intakeId?: string;
  source: Omit<TranscriptSourceV1, "artifactRevision">;
  audioPath: string;
  durationSeconds: number;
  contentType: string;
  provider: SttProviderId;
  model: string;
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
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
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

function contentPath(outputDir: string, absolutePath: string): string {
  const rel = relative(outputDir, absolutePath);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) {
    throw new Error("Transcript representation path must be inside outputDir");
  }
  return rel.split(sep).join("/");
}

function recordIdentity(input: {
  source: TranscriptSourceV1;
  payloadSha256: string;
}): string {
  const identity = canonicalJson({
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    authority: input.source.authority,
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
    if (existing !== content) {
      throw new Error(`Immutable transcript representation collision at ${path}`);
    }
  }
}

export class TranscriptStore {
  readonly rootDir: string;

  constructor(private outputDir: string) {
    this.rootDir = join(outputDir, "_transcripts", "v1");
  }

  private pathFor(transcriptId: string): string {
    if (!/^trn_[a-f0-9]{64}$/.test(transcriptId)) {
      throw new Error("Invalid transcriptId");
    }
    return join(this.rootDir, transcriptId.slice(4, 6), `${transcriptId}.json`);
  }

  async write(input: TranscriptWriteInput): Promise<StoredTranscript> {
    const [artifact, producerJson] = await Promise.all([
      sha256File(input.audioPath),
      Promise.resolve(canonicalJson(input.transcript)),
    ]);
    const payloadSha256 = sha256Text(producerJson);
    const source: TranscriptSourceV1 = {
      ...input.source,
      artifactRevision: `sha256:${artifact.sha256}`,
    };
    const transcriptId = recordIdentity({ source, payloadSha256 });
    const representationDir = join(
      this.rootDir,
      transcriptId.slice(4, 6),
      transcriptId
    );
    const representations = await Promise.all(
      input.representations.map(async (item) => {
        const immutablePath = join(representationDir, representationFilename(item.format));
        await writeImmutable(immutablePath, item.content);
        return {
          format: item.format,
          relativePath: contentPath(this.outputDir, immutablePath),
          legacyRelativePath: contentPath(this.outputDir, item.absolutePath),
          sha256: sha256Text(item.content),
          bytes: Buffer.byteLength(item.content),
        };
      })
    );
    const record: TranscriptRecordV1 = {
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      transcriptId,
      createdAt: input.createdAt,
      producer: {
        name: "Media2Text",
        technicalId: "youtube2text",
        version: input.producerVersion,
      },
      correlation: {
        runId: input.runId,
        intakeId: input.intakeId,
      },
      source,
      artifact: {
        ...artifact,
        durationSeconds: input.durationSeconds,
        contentType: input.contentType,
      },
      transcription: {
        provider: input.provider,
        model: input.model,
        providerTranscriptId:
          typeof input.transcript.id === "string" ? input.transcript.id : undefined,
        languageCode: input.languageCode,
        languageConfidence: input.languageConfidence,
        payloadSha256,
        payload: input.transcript,
      },
      representations,
    };
    const path = this.pathFor(transcriptId);
    await ensureDir(dirname(path));

    let bytes = canonicalJson(record);
    let created = true;
    try {
      await fs.writeFile(path, bytes, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      bytes = await fs.readFile(path, "utf8");
      const existing = JSON.parse(bytes) as TranscriptRecordV1;
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
    let path: string;
    try {
      path = this.pathFor(transcriptId);
    } catch {
      return undefined;
    }
    try {
      const bytes = await fs.readFile(path, "utf8");
      return {
        record: JSON.parse(bytes) as TranscriptRecordV1,
        recordSha256: sha256Text(bytes),
        bytes: Buffer.byteLength(bytes),
        relativePath: contentPath(this.outputDir, path),
        created: false,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async list(limit = 100): Promise<StoredTranscript[]> {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    let prefixes: string[];
    try {
      prefixes = await fs.readdir(this.rootDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const ids: string[] = [];
    for (const prefix of prefixes.sort()) {
      const dir = join(this.rootDir, prefix);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && /^trn_[a-f0-9]{64}\.json$/.test(entry.name)) {
          ids.push(entry.name.slice(0, -5));
        }
      }
    }
    const records = (await Promise.all(ids.map((id) => this.read(id)))).filter(
      (item): item is StoredTranscript => item !== undefined
    );
    return records
      .sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt))
      .slice(0, boundedLimit);
  }
}

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IntakeRecord } from "./store.js";
import { ensureDir } from "../utils/fs.js";
import { sha256File } from "../transcripts/store.js";

export class ArtifactFetchError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean
  ) {
    super(message);
    this.name = "ArtifactFetchError";
  }
}

function allowedOrigins(): Set<string> {
  return new Set(
    (process.env.Y2T_INTAKE_ARTIFACT_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => new URL(item).origin)
  );
}

function extensionForContentType(contentType: string): string {
  if (contentType === "audio/mpeg" || contentType === "audio/mp3") return "mp3";
  if (contentType === "audio/wav" || contentType === "audio/x-wav") return "wav";
  if (contentType === "audio/mp4" || contentType === "audio/m4a") return "m4a";
  if (contentType === "audio/ogg") return "ogg";
  if (contentType === "audio/flac" || contentType === "audio/x-flac") return "flac";
  return "bin";
}

export async function fetchIntakeArtifact(
  intake: IntakeRecord,
  audioDir: string,
  deps?: { fetch?: typeof fetch; timeoutMs?: number; maxBytes?: number }
): Promise<string> {
  const artifact = intake.request.artifact;
  const url = new URL(artifact.url);
  if (!allowedOrigins().has(url.origin)) {
    throw new ArtifactFetchError(
      "artifact_origin_not_allowed",
      `Artifact origin ${url.origin} is not allowlisted`,
      false
    );
  }
  if (url.username || url.password) {
    throw new ArtifactFetchError(
      "artifact_url_credentials_forbidden",
      "Artifact URLs must not contain credentials",
      false
    );
  }

  const maxBytes = deps?.maxBytes ?? 2 * 1024 * 1024 * 1024;
  if (artifact.bytes > maxBytes) {
    throw new ArtifactFetchError(
      "artifact_too_large",
      `Artifact exceeds configured fetch limit (${maxBytes} bytes)`,
      false
    );
  }
  const timeoutMs = deps?.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchFn = deps?.fetch ?? fetch;
  const targetDir = join(audioDir, "_intakes");
  await ensureDir(targetDir);
  const extension = extensionForContentType(artifact.contentType);
  const targetPath = join(targetDir, `${intake.intakeId}.${extension}`);
  const tempPath = join(targetDir, `.${intake.intakeId}.${randomUUID()}.tmp`);
  const handle = await fs.open(tempPath, "wx");

  try {
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: { accept: artifact.contentType },
      });
    } catch (error) {
      throw new ArtifactFetchError(
        "artifact_fetch_failed",
        error instanceof Error ? error.message : String(error),
        true
      );
    }
    if (!response.ok || !response.body) {
      throw new ArtifactFetchError(
        "artifact_http_error",
        `Artifact endpoint returned HTTP ${response.status}`,
        response.status === 408 || response.status === 429 || response.status >= 500
      );
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength !== artifact.bytes) {
      throw new ArtifactFetchError(
        "artifact_size_mismatch",
        `Artifact Content-Length ${contentLength} does not match ${artifact.bytes}`,
        false
      );
    }

    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of Readable.fromWeb(response.body as never)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      bytes += buffer.length;
      if (bytes > artifact.bytes || bytes > maxBytes) {
        throw new ArtifactFetchError(
          "artifact_too_large",
          "Artifact body exceeded its declared or configured size",
          false
        );
      }
      hash.update(buffer);
      await handle.write(buffer);
    }
    await handle.sync();
    if (bytes !== artifact.bytes) {
      throw new ArtifactFetchError(
        "artifact_size_mismatch",
        `Artifact body ${bytes} bytes does not match ${artifact.bytes}`,
        false
      );
    }
    const digest = hash.digest("hex");
    if (digest !== artifact.sha256) {
      throw new ArtifactFetchError(
        "artifact_hash_mismatch",
        "Artifact SHA-256 verification failed",
        false
      );
    }
    await handle.close();
    try {
      await fs.link(tempPath, targetPath);
      await fs.rm(tempPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await sha256File(targetPath);
      if (existing.bytes !== artifact.bytes || existing.sha256 !== artifact.sha256) {
        throw new ArtifactFetchError(
          "artifact_storage_conflict",
          "Existing intake artifact does not match the declared revision",
          false
        );
      }
      await fs.rm(tempPath, { force: true });
    }
    return targetPath;
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

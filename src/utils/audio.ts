import { promises as fs } from "node:fs";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { execCommand } from "./exec.js";
import { validateFfmpegInstalled, validateFfprobeInstalled } from "./deps.js";

export type AudioChunk = {
  path: string;
  startSeconds: number;
  overlapSeconds: number;
};

export async function getAudioDurationSeconds(audioPath: string): Promise<number> {
  const ffprobe = await validateFfprobeInstalled();
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    audioPath,
  ];
  const res = await execCommand(ffprobe, args);
  if (res.exitCode !== 0) {
    throw new Error(`ffprobe failed: ${res.stderr.trim() || res.stdout.trim()}`);
  }
  const raw = res.stdout.trim();
  const duration = Number(raw);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Invalid audio duration from ffprobe: ${raw}`);
  }
  return duration;
}

export async function splitAudioByLimit(
  audioPath: string,
  maxBytes: number,
  overlapSeconds: number
): Promise<{ chunks: AudioChunk[]; cleanup: () => Promise<void> }> {
  const stats = await fs.stat(audioPath);
  if (stats.size <= maxBytes) {
    return {
      chunks: [{ path: audioPath, startSeconds: 0, overlapSeconds: 0 }],
      cleanup: async () => undefined,
    };
  }

  const duration = await getAudioDurationSeconds(audioPath);
  const bytesPerSecond = stats.size / duration;
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    throw new Error("Unable to estimate audio bitrate for splitting.");
  }

  const safeMaxBytes = maxBytes * 0.95;
  const overlap = Math.max(0, overlapSeconds);
  const baseChunkSeconds = Math.max(
    1,
    Math.floor(safeMaxBytes / bytesPerSecond) - overlap
  );
  const chunkCount = Math.ceil(duration / baseChunkSeconds);
  const tmp = await fs.mkdtemp(join(tmpdir(), "y2t-audio-split-"));
  const ext = extname(audioPath).replace(".", "") || "mp3";
  const ffmpeg = await validateFfmpegInstalled();

  const chunks: AudioChunk[] = [];
  for (let idx = 0; idx < chunkCount; idx += 1) {
    const baseStart = idx * baseChunkSeconds;
    const extra = idx === 0 ? 0 : overlap;
    const startSeconds = Math.max(0, baseStart - extra);
    const endSeconds = Math.min(duration, baseStart + baseChunkSeconds + extra);
    const length = Math.max(0.1, endSeconds - startSeconds);
    const outPath = join(tmp, `chunk_${String(idx + 1).padStart(4, "0")}.${ext}`);

    const args = [
      "-y",
      "-ss",
      startSeconds.toFixed(3),
      "-t",
      length.toFixed(3),
      "-i",
      audioPath,
      "-c",
      "copy",
      outPath,
    ];
    const res = await execCommand(ffmpeg, args);
    if (res.exitCode !== 0) {
      throw new Error(`ffmpeg split failed: ${res.stderr.trim() || res.stdout.trim()}`);
    }

    const outStats = await fs.stat(outPath);
    if (outStats.size > maxBytes) {
      throw new Error(
        `Split chunk exceeds limit (${outStats.size} > ${maxBytes}). Reduce maxAudioMB.`
      );
    }

    chunks.push({ path: outPath, startSeconds, overlapSeconds: extra });
  }

  return {
    chunks,
    cleanup: async () => {
      await fs.rm(tmp, { recursive: true, force: true });
    },
  };
}

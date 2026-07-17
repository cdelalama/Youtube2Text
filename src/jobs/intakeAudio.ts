import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

import { validateFfmpegInstalled } from "../utils/deps.js";
import { execCommand, type ExecResult } from "../utils/exec.js";

type CommandRunner = (
  command: string,
  args: string[]
) => Promise<ExecResult>;

export async function prepareIntakeAudioForProvider(
  inputPath: string,
  contentType: string,
  deps: { ffmpegPath?: string; run?: CommandRunner } = {}
): Promise<string> {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "audio/ogg") return inputPath;

  const extension = extname(inputPath);
  const stem = basename(inputPath, extension);
  const outputPath = join(dirname(inputPath), `${stem}.provider.mp3`);
  try {
    const existing = await fs.stat(outputPath);
    if (existing.isFile() && existing.size > 0) return outputPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporaryPath = join(
    dirname(inputPath),
    `.${stem}.${randomUUID()}.provider.mp3.tmp`
  );
  const ffmpeg = deps.ffmpegPath ?? (await validateFfmpegInstalled());
  const run = deps.run ?? execCommand;
  try {
    const result = await run(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:a:0",
      "-vn",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "64k",
      "-f",
      "mp3",
      temporaryPath,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        `ffmpeg failed to normalize intake audio: ${result.stderr.trim() || result.stdout.trim()}`
      );
    }
    const normalized = await fs.stat(temporaryPath);
    if (!normalized.isFile() || normalized.size <= 0) {
      throw new Error("ffmpeg produced an empty normalized intake artifact");
    }
    await fs.rename(temporaryPath, outputPath);
    return outputPath;
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

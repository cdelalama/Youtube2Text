import { execCommand } from "./exec.js";
import { fileExists } from "./fs.js";

function versionArgs(binaryName: string): string[] {
  const normalized = binaryName.toLowerCase().replace(/\.exe$/, "");
  return normalized === "ffmpeg" || normalized === "ffprobe"
    ? ["-version"]
    : ["--version"];
}

async function tryCommand(cmd: string, binaryName: string): Promise<boolean> {
  const res = await execCommand(cmd, versionArgs(binaryName));
  return res.exitCode === 0;
}

async function resolveBinary(
  binaryName: string,
  explicitPath?: string
): Promise<string | undefined> {
  if (explicitPath) {
    try {
      if (
        (await fileExists(explicitPath)) &&
        (await tryCommand(explicitPath, binaryName))
      ) {
        return explicitPath;
      }
    } catch {
      return undefined;
    }
  }
  const candidates = [binaryName, `${binaryName}.exe`];
  for (const candidate of candidates) {
    try {
      if (await tryCommand(candidate, binaryName)) return candidate;
    } catch {
      // continue
    }
  }
  try {
    const res = await execCommand("where.exe", [binaryName]);
    const firstLine = res.stdout.split(/\r?\n/)[0]?.trim();
    if (firstLine && (await fileExists(firstLine))) {
      if (await tryCommand(firstLine, binaryName)) return firstLine;
    }
  } catch {
    // fall through
  }
  return undefined;
}

export async function resolveYtDlpCommand(
  explicitPath?: string
): Promise<string> {
  const envPath =
    explicitPath ||
    process.env.YT_DLP_PATH ||
    process.env.YTDLP_PATH ||
    undefined;
  if (envPath) {
    try {
      if (
        (await fileExists(envPath)) &&
        (await tryCommand(envPath, "yt-dlp"))
      ) {
        return envPath;
      }
    } catch {
      // fall through
    }
  }

  const resolved = await resolveBinary("yt-dlp");
  if (resolved) return resolved;

  try {
    const res = await execCommand("powershell", [
      "-NoProfile",
      "-Command",
      "(Get-Command yt-dlp).Source",
    ]);
    const candidate = res.stdout.trim();
    if (candidate && (await fileExists(candidate))) {
      if (await tryCommand(candidate, "yt-dlp")) return candidate;
    }
  } catch {
    // fall through
  }

  try {
    const res = await execCommand("pwsh", [
      "-NoProfile",
      "-Command",
      "(Get-Command yt-dlp).Source",
    ]);
    const candidate = res.stdout.trim();
    if (candidate && (await fileExists(candidate))) {
      if (await tryCommand(candidate, "yt-dlp")) return candidate;
    }
  } catch {
    // fall through
  }

  throw new Error(
    "yt-dlp not found. Install it:\n" +
      "  pip install yt-dlp\n" +
      "  or visit: https://github.com/yt-dlp/yt-dlp\n" +
      "If installed via winget, restart your shell so PATH is updated.\n" +
      "You can also set YT_DLP_PATH to the full yt-dlp.exe path."
  );
}

export async function validateYtDlpInstalled(
  explicitPath?: string
): Promise<string> {
  return resolveYtDlpCommand(explicitPath);
}

export async function validateFfmpegInstalled(
  explicitPath?: string
): Promise<string> {
  const resolved =
    (await resolveBinary("ffmpeg", explicitPath)) ||
    (await resolveBinary("ffmpeg", process.env.FFMPEG_PATH));
  if (resolved) return resolved;
  throw new Error(
    "ffmpeg not found. Install it:\n" +
      "  https://ffmpeg.org/download.html\n" +
      "If installed, ensure it is on PATH."
  );
}

export async function validateFfprobeInstalled(
  explicitPath?: string
): Promise<string> {
  const resolved =
    (await resolveBinary("ffprobe", explicitPath)) ||
    (await resolveBinary("ffprobe", process.env.FFPROBE_PATH));
  if (resolved) return resolved;
  throw new Error(
    "ffprobe not found. Install ffmpeg (ffprobe is bundled):\n" +
      "  https://ffmpeg.org/download.html\n" +
      "If installed, ensure it is on PATH."
  );
}

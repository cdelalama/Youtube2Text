import { promises as fs } from "node:fs";
import { join, parse as parsePath } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config/schema.js";
import { execCommand } from "../utils/exec.js";
import { validateYtDlpInstalled } from "../utils/deps.js";
import { getBuildVersion } from "../utils/version.js";

export type DeepHealthDeps = {
  ytDlp: { ok: boolean; version?: string; error?: string };
  ffmpeg: { ok: boolean; error?: string };
  disk: { ok: boolean; freeBytes?: number; freeGb?: number; error?: string };
  persist: { ok: boolean; dir: string; writable: boolean; error?: string };
};

export type HealthResponse = {
  ok: boolean;
  service: string;
  version?: string;
  deps?: DeepHealthDeps;
};

async function checkCommandVersion(
  command: string,
  args: string[]
): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const result = await execCommand(command, args);
    if (result.exitCode !== 0) {
      return { ok: false, error: (result.stderr || result.stdout || "").trim() || "unknown" };
    }
    const out = (result.stdout || result.stderr || "").trim();
    const firstLine = out.split(/\r?\n/)[0]?.trim();
    return { ok: true, version: firstLine || undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function diskFreeBytesForPath(path: string): Promise<number | undefined> {
  const root = parsePath(path).root;
  if (!root) return undefined;

  if (process.platform === "win32") {
    const driveMatch = /^([A-Za-z]):/.exec(root);
    const drive = driveMatch ? driveMatch[1] : undefined;
    if (!drive) return undefined;
    const script = "param($drive) (Get-PSDrive -Name $drive).Free";
    const result = await execCommand("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
      drive,
    ]);
    if (result.exitCode !== 0) return undefined;
    const raw = (result.stdout || "").trim();
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
  }

  const result = await execCommand("df", ["-k", path]);
  if (result.exitCode !== 0) return undefined;
  const lines = (result.stdout || "").trim().split(/\r?\n/);
  if (lines.length < 2) return undefined;
  const parts = lines[1]!.trim().split(/\s+/);
  const availableKb = Number(parts[3]);
  if (!Number.isFinite(availableKb)) return undefined;
  return availableKb * 1024;
}

async function ensureWritableDir(dir: string): Promise<{ writable: boolean; error?: string }> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = join(dir, `.healthcheck_${randomUUID()}.tmp`);
    await fs.writeFile(probe, "ok", "utf8");
    await fs.unlink(probe);
    return { writable: true };
  } catch (err) {
    return { writable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getHealth(
  config: AppConfig,
  opts: { persistRuns: boolean; persistDir?: string }
): Promise<HealthResponse> {
  return {
    ok: true,
    service: "youtube2text-api",
    version: await getBuildVersion(),
  };
}

export async function getDeepHealth(
  config: AppConfig,
  opts: { persistRuns: boolean; persistDir?: string }
): Promise<HealthResponse> {
  const includePaths =
    typeof process.env.Y2T_HEALTH_INCLUDE_PATHS === "string" &&
    process.env.Y2T_HEALTH_INCLUDE_PATHS.trim().toLowerCase() === "true";
  let yt: { ok: boolean; version?: string; error?: string };
  try {
    const ytDlpPath = await validateYtDlpInstalled(config.ytDlpPath);
    yt = await checkCommandVersion(ytDlpPath, ["--version"]);
  } catch (err) {
    yt = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const ff = await checkCommandVersion("ffmpeg", ["-version"]);

  let diskOk = true;
  let freeBytes: number | undefined;
  let diskError: string | undefined;
  try {
    freeBytes = await diskFreeBytesForPath(config.outputDir);
    if (freeBytes === undefined) {
      diskOk = false;
      diskError = "unavailable";
    }
  } catch (err) {
    diskOk = false;
    diskError = err instanceof Error ? err.message : String(err);
  }

  const persistDir = opts.persistDir ?? join(config.outputDir, "_runs");
  const persist = opts.persistRuns
    ? await ensureWritableDir(persistDir)
    : { writable: false };

  const deps: DeepHealthDeps = {
    ytDlp: yt,
    ffmpeg: ff,
    disk: {
      ok: diskOk,
      freeBytes,
      freeGb: typeof freeBytes === "number" ? freeBytes / 1024 / 1024 / 1024 : undefined,
      error: diskError,
    },
    persist: {
      ok: !opts.persistRuns || persist.writable,
      dir: includePaths ? persistDir : "redacted",
      writable: opts.persistRuns ? persist.writable : false,
      error: persist.error,
    },
  };

  const overallOk =
    deps.ytDlp.ok &&
    deps.ffmpeg.ok &&
    deps.disk.ok &&
    deps.persist.ok;

  return {
    ok: overallOk,
    service: "youtube2text-api",
    version: await getBuildVersion(),
    deps,
  };
}

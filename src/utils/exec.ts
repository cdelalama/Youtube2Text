import { spawn } from "node:child_process";

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

function parseEnvInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function getDefaultMaxBufferBytes(): number {
  const raw = parseEnvInt(process.env.Y2T_EXEC_MAX_BYTES, 50 * 1024 * 1024);
  const min = 1024 * 1024;
  const max = 512 * 1024 * 1024;
  if (raw < min) return min;
  if (raw > max) return max;
  return raw;
}

export function execCommand(
  command: string,
  args: string[],
  options: { cwd?: string; maxBufferBytes?: number } = {}
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    delete childEnv.Y2T_CREDENTIAL_MASTER_KEY;
    delete childEnv.Y2T_CREDENTIAL_ADMIN_PROOF_SECRET;
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      env: childEnv,
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const maxBufferBytes = options.maxBufferBytes ?? getDefaultMaxBufferBytes();
    let settled = false;

    const finish = (err?: Error, exitCode?: number) => {
      if (settled) return;
      settled = true;
      if (err) {
        reject(err);
        return;
      }
      resolve({ stdout, stderr, exitCode: exitCode ?? -1 });
    };

    const checkLimit = () => {
      if (maxBufferBytes <= 0) return;
      if (stdoutBytes + stderrBytes <= maxBufferBytes) return;
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish(
        new Error(
          `Process output exceeded ${Math.ceil(maxBufferBytes / (1024 * 1024))}MB`
        )
      );
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBytes += Buffer.byteLength(text);
      checkLimit();
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      stderrBytes += Buffer.byteLength(text);
      checkLimit();
    });

    child.on("error", (err) => finish(err));
    child.on("close", (exitCode) => {
      finish(undefined, exitCode ?? -1);
    });
  });
}

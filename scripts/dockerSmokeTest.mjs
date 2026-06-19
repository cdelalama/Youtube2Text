import { spawn } from "node:child_process";
import net from "node:net";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}\n${stderr}`));
    });
  });
}

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || !address) {
        server.close(() => reject(new Error("Failed to get free port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function fetchWithTimeout(url, timeoutMs, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, ...init });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealthy(baseUrl, timeoutMs) {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetchWithTimeout(`${baseUrl}/health`, 1500);
      if (res.ok) return;
    } catch {
      // ignore until timeout
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${baseUrl}/health`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

function isDockerDaemonNotRunning(message) {
  const m = String(message || "").toLowerCase();
  return (
    m.includes("docker daemon is not running") ||
    m.includes("error during connect") ||
    m.includes("cannot find the file specified") ||
    m.includes("pipe") ||
    m.includes("is the docker daemon running")
  );
}

async function assertDockerReady() {
  try {
    await runCapture("docker", ["version"]);
    await runCapture("docker", ["info"]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isDockerDaemonNotRunning(msg)) {
      throw new Error(
        [
          "Docker is installed but the Docker daemon does not appear to be running.",
          "",
          "Fix:",
          "- Start Docker Desktop",
          "- Wait until it says 'Docker is running'",
          "- Re-run: npm run test:docker-smoke",
          "",
          "Details:",
          msg,
        ].join("\n"),
      );
    }
    throw err;
  }
}

async function cleanupContainer(containerName) {
  try {
    await runCapture("docker", ["rm", "-f", containerName]);
  } catch {
    // ignore
  }
}

async function assertYtDlpEjsReady(containerName) {
  const version = await runCapture("docker", ["exec", containerName, "yt-dlp", "--version"]);
  if (!version.stdout.trim()) throw new Error("yt-dlp --version returned no output");

  await runCapture("docker", [
    "exec",
    containerName,
    "node",
    "-e",
    "const major=Number(process.versions.node.split('.')[0]); if (major < 22) { console.error(`Node ${process.versions.node} is too old for yt-dlp EJS`); process.exit(1); }",
  ]);

  await runCapture("docker", [
    "exec",
    containerName,
    "python3",
    "-c",
    "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('yt_dlp_ejs') else 1)",
  ]);

  const config = await runCapture("docker", ["exec", containerName, "cat", "/etc/yt-dlp.conf"]);
  if (!/^--js-runtimes\s+node\s*$/m.test(config.stdout)) {
    throw new Error("/etc/yt-dlp.conf must enable node for yt-dlp EJS");
  }
}

const imageTag = process.env.Y2T_DOCKER_IMAGE_TAG || "youtube2text-api:smoke";
const containerName = process.env.Y2T_DOCKER_CONTAINER_NAME || "y2t-api-smoke";
const hostPort = Number.parseInt(process.env.Y2T_DOCKER_PORT || "", 10) || (await findFreePort());
const baseUrl = `http://127.0.0.1:${hostPort}`;
const apiKey = process.env.Y2T_API_KEY || "smoke-local-api-key-32-bytes-minimum";

let started = false;

try {
  await assertDockerReady();

  console.log(`\n[smoke] Building Docker image: ${imageTag}`);
  // Use quiet build output so this can run in CI/CLIs with limited log buffers.
  await runCapture("docker", ["build", "-q", "-t", imageTag, "."]);

  await cleanupContainer(containerName);

  console.log(`\n[smoke] Starting container ${containerName} on ${baseUrl}`);
  await run("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "-p",
    `${hostPort}:8787`,
    "-e",
    "ASSEMBLYAI_API_KEY=smoke",
    "-e",
    `Y2T_API_KEY=${apiKey}`,
    imageTag,
  ]);
  started = true;

  console.log(`\n[smoke] Waiting for /health ...`);
  await waitForHealthy(baseUrl, 20_000);

  console.log(`\n[smoke] Checking /runs ...`);
  const runsRes = await fetchWithTimeout(`${baseUrl}/runs`, 1500, {
    headers: { "X-API-Key": apiKey },
  });
  if (!runsRes.ok) throw new Error(`/runs returned ${runsRes.status}`);
  const runsBody = await runsRes.json();
  const runs = Array.isArray(runsBody) ? runsBody : runsBody?.runs;
  if (!Array.isArray(runs)) throw new Error(`/runs did not return an array (or {runs: []})`);

  console.log(`\n[smoke] Checking /settings ...`);
  const settingsRes = await fetchWithTimeout(`${baseUrl}/settings`, 1500, {
    headers: { "X-API-Key": apiKey },
  });
  if (!settingsRes.ok) throw new Error(`/settings returned ${settingsRes.status}`);
  const settingsBody = await settingsRes.json();
  if (!settingsBody || typeof settingsBody !== "object") throw new Error(`/settings returned invalid JSON`);
  if (!("settingsPath" in settingsBody)) throw new Error(`/settings missing settingsPath`);
  if (!("effective" in settingsBody)) throw new Error(`/settings missing effective`);

  console.log(`\n[smoke] Checking yt-dlp EJS readiness ...`);
  await assertYtDlpEjsReady(containerName);

  console.log(`\n[smoke] OK`);
} finally {
  if (started) console.log(`\n[smoke] Cleaning up container ${containerName}`);
  await cleanupContainer(containerName);
}

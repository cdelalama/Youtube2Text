import { readFile } from "node:fs/promises";

const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
const match = /^ARG YT_DLP_VERSION=([^\s]+)$/m.exec(dockerfile);
if (!match?.[1]) {
  throw new Error("Dockerfile must pin a non-empty YT_DLP_VERSION");
}

const pinned = match[1];
if (!/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(pinned)) {
  throw new Error(`Invalid stable yt-dlp pin: ${pinned}`);
}

if (process.argv.includes("--pin-only")) {
  console.log(`[yt-dlp] pinned stable release: ${pinned}`);
  process.exit(0);
}

const response = await fetch("https://pypi.org/pypi/yt-dlp/json", {
  headers: { accept: "application/json" },
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) {
  throw new Error(`PyPI returned HTTP ${response.status}`);
}
const payload = await response.json();
const latest = payload?.info?.version;
if (typeof latest !== "string" || !latest) {
  throw new Error("PyPI response did not include info.version");
}

console.log(`[yt-dlp] pinned=${pinned} latest_stable=${latest}`);
if (latest !== pinned) {
  throw new Error(
    `yt-dlp stable release changed (${pinned} -> ${latest}); test and update the Docker pin deliberately`
  );
}

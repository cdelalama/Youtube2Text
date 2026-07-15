import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const baseUrl = (process.env.Y2T_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const apiKey = process.env.Y2T_API_KEY?.trim();
const outputPath = resolve(process.argv[2] ?? "output/_exports/cortex/transcript-record.v1.json");

if (!apiKey) {
  throw new Error("Y2T_API_KEY is required");
}

const headers = { "x-api-key": apiKey };
const listResponse = await fetch(`${baseUrl}/v1/transcripts?limit=1`, { headers });
if (!listResponse.ok) {
  throw new Error(`Transcript list failed with HTTP ${listResponse.status}`);
}
const list = await listResponse.json();
const latest = list.items?.[0];
if (!latest?.href || !latest?.recordSha256) {
  throw new Error("No Transcript Store v1 record is available to export");
}

const recordResponse = await fetch(`${baseUrl}${latest.href}`, { headers });
if (!recordResponse.ok) {
  throw new Error(`Transcript read failed with HTTP ${recordResponse.status}`);
}
const bytes = Buffer.from(await recordResponse.arrayBuffer());
const digest = createHash("sha256").update(bytes).digest("hex");
if (digest !== latest.recordSha256) {
  throw new Error(`Integrity mismatch: expected ${latest.recordSha256}, received ${digest}`);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, bytes, { flag: "wx" });
const manifest = {
  schemaVersion: "media2text.fixture-manifest.v1",
  transcriptId: latest.transcriptId,
  recordSha256: digest,
  bytes: bytes.length,
  sourceEndpoint: latest.href,
};
await writeFile(`${outputPath}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: "wx",
});
process.stdout.write(`${JSON.stringify(manifest)}\n`);

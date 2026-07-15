import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const fixtureRoot = resolve(process.argv[2] ?? "fixtures/cortex-v1");
const sha256Pattern = /^[a-f0-9]{64}$/;
const forbiddenManifestKey = /(?:api.?key|password|passphrase|secret|token)/i;

function fail(message) {
  throw new Error(`Fixture validation failed: ${message}`);
}

function requireIsoDate(value, field) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    fail(`${field} must be an ISO date`);
  }
}

function requireSha(value, field) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    fail(`${field} must be a lowercase SHA-256 digest`);
  }
}

function rejectSecretKeys(value, path = "manifest") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenManifestKey.test(key)) {
      fail(`${path}.${key} uses a secret-bearing key name`);
    }
    rejectSecretKeys(child, `${path}.${key}`);
  }
}

function requireUnknownReason(manifest, field, value) {
  if (value === undefined) {
    fail(`${field} must be present; use null with an unknownReasons entry when unavailable`);
  }
  if (value !== null) return;
  const reason = manifest.unknownReasons?.[field];
  if (typeof reason !== "string" || reason.trim().length < 12) {
    fail(`${field} is null without a useful unknownReasons entry`);
  }
}

async function validateFixture(fixtureDir) {
  const manifestPath = resolve(fixtureDir, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    fail(`${relative(fixtureRoot, manifestPath)} is not valid JSON: ${error.message}`);
  }

  rejectSecretKeys(manifest);
  if (manifest.schemaVersion !== "media2text.cortex-evidence-fixture.v1") {
    fail(`${manifest.fixtureId ?? relative(fixtureRoot, fixtureDir)} has an unsupported schemaVersion`);
  }
  if (typeof manifest.source?.videoId !== "string" || !manifest.source.videoId) {
    fail(`${manifest.fixtureId} has no source.videoId`);
  }
  if (typeof manifest.source?.url !== "string" || !manifest.source.url.startsWith("https://")) {
    fail(`${manifest.fixtureId} has no HTTPS source.url`);
  }
  if (manifest.artifact?.contentType !== "application/x-ndjson; charset=utf-8") {
    fail(`${manifest.fixtureId} has an unexpected artifact contentType`);
  }
  if (!Number.isSafeInteger(manifest.artifact?.bytes) || manifest.artifact.bytes <= 0) {
    fail(`${manifest.fixtureId} has invalid artifact.bytes`);
  }
  if (typeof manifest.artifact?.language !== "string" || !manifest.artifact.language) {
    fail(`${manifest.fixtureId} has no artifact.language`);
  }
  requireSha(manifest.artifact.sha256, "artifact.sha256");
  requireIsoDate(manifest.artifact.createdAt, "artifact.createdAt");
  requireIsoDate(manifest.source?.publicCheck?.checkedAt, "source.publicCheck.checkedAt");

  const artifactPath = resolve(fixtureDir, manifest.artifact.path ?? "");
  const artifactRelative = relative(fixtureDir, artifactPath);
  if (!manifest.artifact.path || isAbsolute(manifest.artifact.path)
      || artifactRelative.startsWith("..") || isAbsolute(artifactRelative)) {
    fail(`${manifest.fixtureId} artifact.path escapes its fixture directory`);
  }

  const bytes = await readFile(artifactPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== manifest.artifact.bytes) {
    fail(`${manifest.fixtureId} expected ${manifest.artifact.bytes} bytes, received ${bytes.length}`);
  }
  if (digest !== manifest.artifact.sha256) {
    fail(`${manifest.fixtureId} expected ${manifest.artifact.sha256}, received ${digest}`);
  }

  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const terminalNewline = text.endsWith("\n");
  if (terminalNewline !== manifest.artifact.terminalNewline) {
    fail(`${manifest.fixtureId} terminal newline state changed`);
  }
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length !== manifest.artifact.lineCount || lines.length === 0) {
    fail(`${manifest.fixtureId} expected ${manifest.artifact.lineCount} JSONL records, received ${lines.length}`);
  }

  lines.forEach((line, index) => {
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      fail(`${manifest.fixtureId} line ${index + 1} is invalid JSON: ${error.message}`);
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      fail(`${manifest.fixtureId} line ${index + 1} is not a JSON object`);
    }
    if (record.videoId !== manifest.source.videoId) {
      fail(`${manifest.fixtureId} line ${index + 1} videoId does not match the manifest`);
    }
    if (record.languageCode !== manifest.artifact.language) {
      fail(`${manifest.fixtureId} line ${index + 1} languageCode does not match the manifest`);
    }
  });

  for (const [name, timestamp] of Object.entries(manifest.provenance?.timestamps ?? {})) {
    requireIsoDate(timestamp, `provenance.timestamps.${name}`);
  }
  if (typeof manifest.provenance?.runId !== "string" || !manifest.provenance.runId) {
    fail(`${manifest.fixtureId} has no demonstrated provenance.runId`);
  }
  requireUnknownReason(manifest, "provenance.provider", manifest.provenance?.provider);
  requireUnknownReason(manifest, "provenance.engine", manifest.provenance?.engine);
  requireUnknownReason(manifest, "provenance.model", manifest.provenance?.model);
  requireUnknownReason(manifest, "provenance.modelVersion", manifest.provenance?.modelVersion);
  requireUnknownReason(manifest, "commits.artifactProducer", manifest.commits?.artifactProducer);
  requireUnknownReason(manifest, "commits.fixtureCommit", manifest.commits?.fixtureCommit);
  if (!/^[a-f0-9]{40}$/.test(manifest.commits?.exportSource ?? "")) {
    fail(`${manifest.fixtureId} has no full commits.exportSource SHA`);
  }
  if (!Array.isArray(manifest.evidence) || manifest.evidence.length === 0) {
    fail(`${manifest.fixtureId} has no source evidence references`);
  }
  manifest.evidence.forEach((item, index) => requireSha(item?.sha256, `evidence[${index}].sha256`));

  return {
    fixtureId: manifest.fixtureId,
    videoId: manifest.source.videoId,
    records: lines.length,
    bytes: bytes.length,
    sha256: digest,
  };
}

const entries = (await readdir(fixtureRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name));
if (entries.length === 0) fail("no fixture directories found");

for (const entry of entries) {
  const result = await validateFixture(resolve(fixtureRoot, entry.name));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

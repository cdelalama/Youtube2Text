import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function extractFirstMatch(text, pattern) {
  const match = text.match(pattern);
  return match?.[1];
}

async function readJson(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

async function readOpenApiVersion(path) {
  const raw = await readFile(path, "utf8");
  const parsed = YAML.parse(raw);
  return parsed?.info?.version;
}

export async function collectVersionState(rootDir = process.cwd()) {
  const packagePath = resolve(rootDir, "package.json");
  const openapiPath = resolve(rootDir, "openapi.yaml");
  const handoffPath = resolve(rootDir, "docs/llm/HANDOFF.md");
  const contextPath = resolve(rootDir, "docs/PROJECT_CONTEXT.md");

  const pkg = await readJson(packagePath);
  const openapiVersion = await readOpenApiVersion(openapiPath);
  const handoffRaw = await readFile(handoffPath, "utf8");
  const contextRaw = await readFile(contextPath, "utf8");

  return {
    packagePath,
    openapiPath,
    handoffPath,
    contextPath,
    packageVersion: pkg?.version,
    openapiVersion,
    handoffVersion: extractFirstMatch(handoffRaw, /- Version:\s*([0-9]+\.[0-9]+\.[0-9]+)/),
    projectContextVersion: extractFirstMatch(contextRaw, /\bv([0-9]+\.[0-9]+\.[0-9]+)\s+stable\b/i),
  };
}

export function validateVersionState(state) {
  const errors = [];
  const {
    packageVersion,
    openapiVersion,
    handoffVersion,
    projectContextVersion,
  } = state;

  if (!SEMVER_RE.test(String(packageVersion ?? ""))) {
    errors.push(`Invalid package.json version: ${String(packageVersion)}`);
  }
  if (!SEMVER_RE.test(String(openapiVersion ?? ""))) {
    errors.push(`Invalid openapi.yaml info.version: ${String(openapiVersion)}`);
  }
  if (!SEMVER_RE.test(String(handoffVersion ?? ""))) {
    errors.push("Missing or invalid version in docs/llm/HANDOFF.md (Current Status).");
  }
  if (!SEMVER_RE.test(String(projectContextVersion ?? ""))) {
    errors.push("Missing or invalid stable version marker in docs/PROJECT_CONTEXT.md.");
  }

  if (packageVersion && openapiVersion && packageVersion !== openapiVersion) {
    errors.push(
      `Version mismatch: package.json=${packageVersion} openapi.yaml=${openapiVersion}`,
    );
  }
  if (packageVersion && handoffVersion && packageVersion !== handoffVersion) {
    errors.push(
      `Version mismatch: package.json=${packageVersion} docs/llm/HANDOFF.md=${handoffVersion}`,
    );
  }
  if (packageVersion && projectContextVersion && packageVersion !== projectContextVersion) {
    errors.push(
      `Version mismatch: package.json=${packageVersion} docs/PROJECT_CONTEXT.md=${projectContextVersion}`,
    );
  }

  return { errors };
}

export function formatVersionReport(state) {
  return [
    `[version-check] package.json: ${state.packageVersion}`,
    `[version-check] openapi.yaml: ${state.openapiVersion}`,
    `[version-check] docs/llm/HANDOFF.md: ${state.handoffVersion}`,
    `[version-check] docs/PROJECT_CONTEXT.md: ${state.projectContextVersion}`,
  ].join("\n");
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  const state = await collectVersionState();
  const { errors } = validateVersionState(state);
  process.stdout.write(`${formatVersionReport(state)}\n`);
  if (errors.length > 0) {
    process.stderr.write(`[version-check] FAILED\n- ${errors.join("\n- ")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("[version-check] OK\n");
  }
}

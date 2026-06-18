import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_ROOT_PACKAGE_NAME = "youtube2text";
const FORBIDDEN_ENV_PREFIX_RE = /\b(?:MEDIA2TEXT|M2T)_[A-Z0-9_]+\b/g;

const ALLOWED_FORBIDDEN_PREFIX_MENTIONS = new Set([
  "docs/llm/DECISIONS.md",
  "docs/llm/HANDOFF.md",
  "docs/llm/HISTORY.md",
  "scripts/check-naming-contract.mjs",
  "tests/namingContract.test.ts",
]);

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "audio",
  "coverage",
  "dist",
  "node_modules",
  "output",
]);

async function readJson(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

async function collectFilesRecursive(rootDir, dir = rootDir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFilesRecursive(rootDir, fullPath, files);
    } else if (entry.isFile()) {
      files.push(relative(rootDir, fullPath).split("\\").join("/"));
    }
  }
  return files;
}

async function collectContractFiles(rootDir) {
  try {
    const out = execFileSync("git", ["-C", rootDir, "ls-files", "-co", "--exclude-standard"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return collectFilesRecursive(rootDir);
  }
}

function isLikelyText(buffer) {
  return !buffer.includes(0);
}

export async function checkNamingContract(rootDir = process.cwd()) {
  const errors = [];
  const packageJsonPath = resolve(rootDir, "package.json");
  const pkg = await readJson(packageJsonPath);

  if (pkg.name !== EXPECTED_ROOT_PACKAGE_NAME) {
    errors.push(
      `package.json name must remain "${EXPECTED_ROOT_PACKAGE_NAME}" (found "${String(pkg.name)}")`,
    );
  }

  const files = await collectContractFiles(rootDir);
  for (const file of files) {
    if (ALLOWED_FORBIDDEN_PREFIX_MENTIONS.has(file)) continue;

    let buffer;
    try {
      buffer = await readFile(resolve(rootDir, file));
    } catch {
      continue;
    }
    if (!isLikelyText(buffer)) continue;

    const text = buffer.toString("utf8");
    const matches = [...text.matchAll(FORBIDDEN_ENV_PREFIX_RE)].map((match) => match[0]);
    if (matches.length > 0) {
      const unique = [...new Set(matches)].join(", ");
      errors.push(`${file} introduces forbidden Media2Text env prefix(es): ${unique}`);
    }
  }

  return { errors };
}

const isMain = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (isMain) {
  const { errors } = await checkNamingContract();
  if (errors.length > 0) {
    process.stderr.write(`[naming-contract] FAILED\n- ${errors.join("\n- ")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("[naming-contract] OK\n");
  }
}

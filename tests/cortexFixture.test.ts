import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtureRoot = join(process.cwd(), "fixtures", "cortex-v1");

function runValidator(root = fixtureRoot) {
  return spawnSync(process.execPath, ["scripts/validate-transcript-fixture.mjs", root], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function withMutatedManifest(mutate: (manifest: any) => void) {
  const root = mkdtempSync(join(tmpdir(), "media2text-fixture-"));
  const fixtureDir = join(root, "ngAasdHcHxo");
  cpSync(join(fixtureRoot, "ngAasdHcHxo"), fixtureDir, { recursive: true });
  const manifestPath = join(fixtureDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  mutate(manifest);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    return runValidator(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Cortex evidence fixture remains byte-stable valid JSONL", () => {
  const result = runValidator();

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout.trim());
  assert.deepEqual(summary, {
    fixtureId: "youtube-ngAasdHcHxo-jsonl",
    videoId: "ngAasdHcHxo",
    records: 1,
    bytes: 11887,
    sha256: "c44a7e35344c02e88fdb20f9f7987486d6852da28edef35496b2255ee4b86744",
  });
});

test("Cortex fixture rejects omitted provenance instead of treating it as known", () => {
  const result = withMutatedManifest((manifest) => {
    delete manifest.provenance.provider;
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /provenance\.provider must be present/);
});

test("Cortex fixture rejects null provenance without an explicit reason", () => {
  const result = withMutatedManifest((manifest) => {
    delete manifest.unknownReasons["provenance.provider"];
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /provenance\.provider is null without a useful unknownReasons entry/);
});

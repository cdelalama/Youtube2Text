import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectVersionState, validateVersionState } from "../scripts/versionCheck.mjs";

function createFixture(version = "1.2.3") {
  const root = mkdtempSync(join(tmpdir(), "y2t-version-check-"));
  mkdirSync(join(root, "docs/llm"), { recursive: true });

  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture", version }, null, 2),
    "utf8",
  );
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify(
      {
        name: "fixture",
        version,
        lockfileVersion: 3,
        packages: { "": { name: "fixture", version } },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(root, "openapi.yaml"),
    `openapi: 3.1.0\ninfo:\n  title: Fixture API\n  version: ${version}\npaths: {}\n`,
    "utf8",
  );
  writeFileSync(
    join(root, "docs/llm/HANDOFF.md"),
    `## Current Status\n- Version: ${version}\n`,
    "utf8",
  );
  writeFileSync(
    join(root, "docs/PROJECT_CONTEXT.md"),
    `## Current Status\nv${version} stable.\n`,
    "utf8",
  );

  return root;
}

test("version check passes for synchronized versions", async () => {
  const root = createFixture("2.4.6");
  const state = await collectVersionState(root);
  const { errors } = validateVersionState(state);
  assert.deepEqual(errors, []);
});

test("version check detects package/openapi mismatch", async () => {
  const root = createFixture("1.0.0");
  writeFileSync(
    join(root, "openapi.yaml"),
    "openapi: 3.1.0\ninfo:\n  title: Fixture API\n  version: 1.0.1\npaths: {}\n",
    "utf8",
  );
  const state = await collectVersionState(root);
  const { errors } = validateVersionState(state);
  assert.equal(errors.some((msg) => msg.includes("Version mismatch: package.json=1.0.0 openapi.yaml=1.0.1")), true);
});

test("version check detects package-lock mismatch", async () => {
  const root = createFixture("1.0.0");
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify(
      {
        name: "fixture",
        version: "1.0.1",
        lockfileVersion: 3,
        packages: { "": { name: "fixture", version: "1.0.1" } },
      },
      null,
      2,
    ),
    "utf8",
  );
  const state = await collectVersionState(root);
  const { errors } = validateVersionState(state);
  assert.equal(errors.some((msg) => msg.includes("package-lock.json=1.0.1")), true);
});

test("repository keeps version markers synchronized", async () => {
  const state = await collectVersionState(process.cwd());
  const { errors } = validateVersionState(state);
  assert.deepEqual(errors, []);
});

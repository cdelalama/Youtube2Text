import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkNamingContract } from "../scripts/check-naming-contract.mjs";

function createFixture(packageName = "youtube2text") {
  const root = mkdtempSync(join(tmpdir(), "y2t-naming-contract-"));
  mkdirSync(join(root, "docs/llm"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: packageName, version: "1.2.3" }, null, 2),
    "utf8",
  );
  writeFileSync(join(root, "README.md"), "# Media2Text\n\nVisible product brand.\n", "utf8");
  writeFileSync(
    join(root, "docs/llm/DECISIONS.md"),
    "D-018 allows mentioning MEDIA2TEXT_ as a prohibited prefix.\n",
    "utf8",
  );
  return root;
}

function initializeGitFixture(root: string) {
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "package.json", "README.md", "docs/llm/DECISIONS.md"], {
    cwd: root,
    stdio: "ignore",
  });
}

test("naming contract allows Media2Text copy with youtube2text package name", async () => {
  const root = createFixture();
  const { errors } = await checkNamingContract(root);
  assert.deepEqual(errors, []);
});

test("naming contract rejects root package rename", async () => {
  const root = createFixture("media2text");
  const { errors } = await checkNamingContract(root);
  assert.equal(errors.some((msg) => msg.includes("package.json name must remain")), true);
});

test("naming contract rejects new Media2Text env prefixes", async () => {
  const root = createFixture();
  writeFileSync(join(root, "config.yaml.example"), "apiKeyEnv: MEDIA2TEXT_API_KEY\n", "utf8");
  const { errors } = await checkNamingContract(root);
  assert.equal(
    errors.some((msg) => msg.includes("config.yaml.example") && msg.includes("MEDIA2TEXT_API_KEY")),
    true,
  );
});

test("naming contract rejects short M2T env prefixes", async () => {
  const root = createFixture();
  writeFileSync(join(root, ".env.example"), "M2T_API_KEY=bad\n", "utf8");
  const { errors } = await checkNamingContract(root);
  assert.equal(errors.some((msg) => msg.includes(".env.example") && msg.includes("M2T_API_KEY")), true);
});

test("naming contract rejects untracked Media2Text env prefixes", async () => {
  const root = createFixture();
  initializeGitFixture(root);
  writeFileSync(join(root, "local-config.example"), "apiKeyEnv: MEDIA2TEXT_API_KEY\n", "utf8");

  const { errors } = await checkNamingContract(root);

  assert.equal(
    errors.some((msg) => msg.includes("local-config.example") && msg.includes("MEDIA2TEXT_API_KEY")),
    true,
  );
});

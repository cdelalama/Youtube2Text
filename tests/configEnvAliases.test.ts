import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigSourceSnapshots } from "../src/config/loader.js";

function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const prev: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function tempConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "y2t-env-alias-"));
  const path = join(dir, "config.yaml");
  writeFileSync(path, "{}", "utf8");
  return path;
}

test("env config prefers Y2T_ prefixed values over legacy names", async () => {
  await withEnv(
    {
      Y2T_CONCURRENCY: "5",
      CONCURRENCY: "2",
      Y2T_FILENAME_STYLE: "title_id",
      FILENAME_STYLE: "id",
      Y2T_YT_DLP_PATH: "pref.exe",
      YT_DLP_PATH: "legacy.exe",
    },
    () => {
      const cfgPath = tempConfigPath();
      const snap = loadConfigSourceSnapshots(cfgPath, { outputDirOverride: "output" });
      assert.equal(snap.envConfig.concurrency, 5);
      assert.equal(snap.envConfig.filenameStyle, "title_id");
      assert.equal(snap.envConfig.ytDlpPath, "pref.exe");
    }
  );
});

test("env config falls back to legacy names when Y2T_ vars are absent", async () => {
  await withEnv(
    {
      Y2T_CONCURRENCY: undefined,
      CONCURRENCY: "4",
      Y2T_FILENAME_STYLE: undefined,
      FILENAME_STYLE: "id_title",
    },
    () => {
      const cfgPath = tempConfigPath();
      const snap = loadConfigSourceSnapshots(cfgPath, { outputDirOverride: "output" });
      assert.equal(snap.envConfig.concurrency, 4);
      assert.equal(snap.envConfig.filenameStyle, "id_title");
    }
  );
});

test("empty optional numeric env values remain unset", async () => {
  await withEnv(
    {
      Y2T_MAX_AUDIO_MB: "",
      Y2T_CATALOG_MAX_AGE_HOURS: "  ",
    },
    () => {
      const cfgPath = tempConfigPath();
      const snap = loadConfigSourceSnapshots(cfgPath, { outputDirOverride: "output" });
      assert.equal(snap.envConfig.maxAudioMB, undefined);
      assert.equal(snap.envConfig.catalogMaxAgeHours, undefined);
    }
  );
});

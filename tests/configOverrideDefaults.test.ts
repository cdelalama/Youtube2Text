import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeConfigOverrides } from "../src/api/sanitize.js";
import { configSchemaBase } from "../src/config/schema.js";
import { runCreateSchema, runPlanSchema } from "../src/api/schemas.js";

test("partial overrides do not inject defaults or replace provider and paths", () => {
  assert.deepEqual(sanitizeConfigOverrides({}), {});
  assert.deepEqual(sanitizeConfigOverrides({ languageCode: "es", concurrency: 1 }),
    { languageCode: "es", concurrency: 1 });
  assert.deepEqual(sanitizeConfigOverrides({ sttProvider: undefined }), {});
  assert.deepEqual(sanitizeConfigOverrides({ assemblyAiApiKey: "removed", deepgramApiKeys: ["removed"] }), {});
  const effective = { sttProvider: "deepgram", outputDir: "/data/output", audioDir: "/data/audio" };
  assert.deepEqual({ ...effective, ...sanitizeConfigOverrides({}) }, effective);
  assert.equal(configSchemaBase.parse({}).sttProvider, "assemblyai");
});

test("oversized run collections fail with bounded issues before element validation", () => {
  const oversized = Array(100_000).fill(123);
  for (const schema of [runCreateSchema, runPlanSchema]) {
    for (const body of [{ url: "https://example.com", videoIds: oversized },
      { url: "https://example.com", config: { videoIds: oversized } }]) {
      const result = schema.safeParse(body);
      assert.equal(result.success, false);
      if (!result.success) assert.ok(result.error.issues.length < 5);
    }
  }
  const result = configSchemaBase.partial().safeParse({ videoIds: oversized });
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.issues.length, 1);
});

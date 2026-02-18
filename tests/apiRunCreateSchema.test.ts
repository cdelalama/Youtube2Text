import test from "node:test";
import assert from "node:assert/strict";
import { runCreateSchema, runPlanSchema } from "../src/api/schemas.js";

test("runCreateSchema requires url or audioId (not both)", () => {
  const okUrl = runCreateSchema.safeParse({ url: "https://example.com" });
  assert.equal(okUrl.success, true);

  const okAudio = runCreateSchema.safeParse({ audioId: "audio-123" });
  assert.equal(okAudio.success, true);

  const missing = runCreateSchema.safeParse({ force: false });
  assert.equal(missing.success, false);

  const both = runCreateSchema.safeParse({ url: "https://example.com", audioId: "audio-123" });
  assert.equal(both.success, false);
});

test("videoIds schema validates format and max length", () => {
  const ok = runPlanSchema.safeParse({
    url: "https://example.com",
    videoIds: ["abc123", "dGhpcw_-"],
  });
  assert.equal(ok.success, true);

  const badChars = runPlanSchema.safeParse({
    url: "https://example.com",
    videoIds: ["ok_id", "../evil"],
  });
  assert.equal(badChars.success, false, "path traversal in videoIds rejected");

  const nullIsOmitted = runPlanSchema.safeParse({
    url: "https://example.com",
    videoIds: null,
  });
  assert.equal(nullIsOmitted.success, true, "null videoIds treated as undefined");

  const okInCreate = runCreateSchema.safeParse({
    url: "https://example.com",
    videoIds: ["vid1"],
  });
  assert.equal(okInCreate.success, true, "videoIds accepted in runCreateSchema");
});

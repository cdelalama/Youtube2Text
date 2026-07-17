import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function schema(name: string): Promise<any> {
  return JSON.parse(await readFile(new URL(`../docs/contracts/${name}`, import.meta.url), "utf8"));
}

test("Transcript Store v2 contract requires source time and exact provenance", async () => {
  const store = await schema("transcript-store.v2.schema.json");
  assert.equal(store.$id, "https://media2text.local/contracts/transcript-store.v2.schema.json");
  assert.ok(store.required.includes("materializedAt"));
  assert.ok(store.$defs.source.required.includes("createdAt"));
  assert.ok(store.$defs.source.required.includes("createdAtType"));
  assert.ok(store.$defs.artifact.required.includes("revision"));
  assert.ok(store.$defs.transcription.required.includes("model"));
  assert.ok(store.$defs.transcription.required.includes("providerTranscriptIdEvidence"));
  assert.ok(store.$defs.transcription.properties.model.required.includes("nameUnavailableReason"));
  assert.ok(store.$defs.representation.required.includes("derivedFrom"));
});

test("Transcript Ready v1 contract carries revision and withdrawal semantics", async () => {
  const ready = await schema("transcript-ready.v1.schema.json");
  assert.equal(ready["x-contract-status"], "draft-consumer-re-review-required");
  assert.deepEqual(ready.properties.eventType.enum, ["transcript.ready", "transcript.withdrawn"]);
  assert.ok(ready.required.includes("lifecycle"));
  assert.ok(ready.properties.lifecycle.required.includes("supersedesTranscriptId"));
  assert.ok(ready.properties.sourceLifecycle.required.includes("sourceEventId"));
  assert.equal(
    ready.properties.source.oneOf[1].$ref,
    "transcript-store.v2.schema.json#/$defs/source"
  );
});

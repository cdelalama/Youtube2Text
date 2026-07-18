import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

async function schema(name: string): Promise<any> {
  return JSON.parse(await readFile(new URL(`../docs/contracts/${name}`, import.meta.url), "utf8"));
}

test("Transcript Store v2 contract requires source time and exact provenance", async () => {
  const store = await schema("transcript-store.v2.schema.json");
  assert.equal(store.$id, "https://media2text.local/contracts/transcript-store.v2.schema.json");
  assert.equal("x-contract-status" in store, false);
  assert.match(store.description, /externally by producer commit and SHA-256 pins/);
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
  assert.equal("x-contract-status" in ready, false);
  assert.match(ready.description, /externally by producer commit and SHA-256 pins/);
  assert.deepEqual(ready.properties.eventType.enum, ["transcript.ready", "transcript.withdrawn"]);
  assert.ok(ready.required.includes("lifecycle"));
  assert.ok(ready.properties.lifecycle.required.includes("supersedesTranscriptId"));
  assert.ok(ready.properties.sourceLifecycle.required.includes("sourceEventId"));
  assert.equal(
    ready.properties.source.oneOf[1].$ref,
    "transcript-store.v2.schema.json#/$defs/source"
  );
});

async function transcriptReadyValidator() {
  const [ready, storeV1, storeV2] = await Promise.all([
    schema("transcript-ready.v1.schema.json"),
    schema("transcript-store.v1.schema.json"),
    schema("transcript-store.v2.schema.json"),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(storeV1);
  ajv.addSchema(storeV2);
  return ajv.compile(ready);
}

function readyEvent(): any {
  return {
    schemaVersion: "media2text.transcript-ready.v1",
    eventType: "transcript.ready",
    eventId: `evt_${"a".repeat(64)}`,
    idempotencyKey: "transcript.ready:test",
    occurredAt: "2026-07-18T00:00:00.000Z",
    correlation: { runId: "run-test", intakeId: null },
    source: {
      kind: "intake",
      authority: "plaud-mirror",
      sourceItemId: "recording-test",
      title: "Contract test",
      artifactRevision: `sha256:${"b".repeat(64)}`,
    },
    transcript: {
      transcriptId: `trn_${"c".repeat(64)}`,
      recordSha256: "d".repeat(64),
      recordBytes: 128,
      schemaVersion: "media2text.transcript.v2",
      href: `/v1/transcripts/trn_${"c".repeat(64)}`,
    },
    lifecycle: {
      revision: 1,
      revisionReason: "initial",
      status: "current",
      current: true,
      supersedesTranscriptId: null,
      supersededByTranscriptId: null,
    },
  };
}

function withdrawnEvent(): any {
  const event = readyEvent();
  event.eventType = "transcript.withdrawn";
  event.idempotencyKey = "transcript.withdrawn:test";
  event.lifecycle.status = "withdrawn";
  event.lifecycle.current = false;
  event.sourceLifecycle = {
    authority: "plaud-mirror",
    sourceEventId: "source-event-test",
    occurredAt: "2026-07-18T00:00:00.000Z",
    reason: "deleted at source",
  };
  return event;
}

test("Transcript Ready v1 schema couples ready events to current lifecycle", async () => {
  const validate = await transcriptReadyValidator();
  const valid = readyEvent();
  assert.equal(validate(valid), true, JSON.stringify(validate.errors));

  const withdrawnStatus = structuredClone(valid);
  withdrawnStatus.lifecycle.status = "withdrawn";
  assert.equal(validate(withdrawnStatus), false);

  const notCurrent = structuredClone(valid);
  notCurrent.lifecycle.current = false;
  assert.equal(validate(notCurrent), false);

  const sourceLifecycle = structuredClone(valid);
  sourceLifecycle.sourceLifecycle = withdrawnEvent().sourceLifecycle;
  assert.equal(validate(sourceLifecycle), false);
});

test("Transcript Ready v1 schema couples withdrawn events to source lifecycle", async () => {
  const validate = await transcriptReadyValidator();
  const valid = withdrawnEvent();
  assert.equal(validate(valid), true, JSON.stringify(validate.errors));

  const currentStatus = structuredClone(valid);
  currentStatus.lifecycle.status = "current";
  assert.equal(validate(currentStatus), false);

  const stillCurrent = structuredClone(valid);
  stillCurrent.lifecycle.current = true;
  assert.equal(validate(stillCurrent), false);

  const missingSourceLifecycle = structuredClone(valid);
  delete missingSourceLifecycle.sourceLifecycle;
  assert.equal(validate(missingSourceLifecycle), false);
});

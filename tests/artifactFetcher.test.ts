import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fetchIntakeArtifact, ArtifactFetchError } from "../src/jobs/artifactFetcher.js";
import { MediaJobStore, type IntakeRequestV1 } from "../src/jobs/store.js";

test("artifact fetch verifies origin, size, and SHA-256 before admission", async () => {
  const previous = process.env.Y2T_INTAKE_ARTIFACT_ALLOWED_ORIGINS;
  process.env.Y2T_INTAKE_ARTIFACT_ALLOWED_ORIGINS = "https://source.example";
  const dir = await mkdtemp(join(tmpdir(), "y2t-artifact-"));
  const body = Buffer.from("verified-audio");
  const digest = createHash("sha256").update(body).digest("hex");
  const request: IntakeRequestV1 = {
    schemaVersion: "media2text.intake.v1",
    eventId: "evt-1",
    idempotencyKey: "fixture-1",
    source: {
      authority: "plaud-mirror",
      itemId: "item-1",
      artifactRevision: `sha256:${digest}`,
    },
    artifact: {
      url: "https://source.example/audio/1",
      sha256: digest,
      bytes: body.length,
      contentType: "audio/mpeg",
    },
  };
  const store = new MediaJobStore(dir);
  try {
    const intake = store.createIntake(request).record;
    const path = await fetchIntakeArtifact(intake, join(dir, "audio"), {
      fetch: async () => new Response(body, { status: 200, headers: { "content-length": String(body.length) } }),
    });
    assert.deepEqual(await readFile(path), body);

    const bad = store.createIntake({
      ...request,
      eventId: "evt-2",
      idempotencyKey: "fixture-2",
      source: { ...request.source, itemId: "item-2", artifactRevision: `sha256:${"f".repeat(64)}` },
      artifact: { ...request.artifact, sha256: "f".repeat(64) },
    }).record;
    await assert.rejects(
      fetchIntakeArtifact(bad, join(dir, "audio"), {
        fetch: async () =>
          new Response(body, {
            status: 200,
            headers: { "content-length": String(body.length) },
          }),
      }),
      (error: unknown) => error instanceof ArtifactFetchError && error.code === "artifact_hash_mismatch"
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.Y2T_INTAKE_ARTIFACT_ALLOWED_ORIGINS;
    else process.env.Y2T_INTAKE_ARTIFACT_ALLOWED_ORIGINS = previous;
  }
});

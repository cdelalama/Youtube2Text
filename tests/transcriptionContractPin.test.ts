import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Plaud compatibility profile is pinned to the reviewed producer commit", async () => {
  const root = new URL(
    "../docs/contracts/plaud-mirror-transcription-intake-v1/",
    import.meta.url
  );
  const pin = JSON.parse(await readFile(new URL("pin.json", root), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("manifest.v1.json", root), "utf8"));
  assert.equal(pin.profile, "plaud-mirror.transcription-intake.v1");
  assert.equal(pin.producerCommit, "d393a0cefa17dfc4788294ef9bb5e5a89ed0f6b4");
  assert.equal(manifest.profile, pin.profile);
  for (const [filename, expected] of Object.entries(manifest.schemas) as Array<[
    string,
    { bytes: number; sha256: string },
  ]>) {
    const bytes = await readFile(new URL(filename, root));
    assert.equal(bytes.byteLength, expected.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected.sha256);
    JSON.parse(bytes.toString("utf8"));
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { prepareIntakeAudioForProvider } from "../src/jobs/intakeAudio.js";

test("provider intake keeps non-OGG artifacts byte-identical", async () => {
  const input = "/tmp/intake.mp3";
  assert.equal(
    await prepareIntakeAudioForProvider(input, "audio/mpeg", {
      run: async () => {
        throw new Error("runner must not be called");
      },
    }),
    input
  );
});

test("provider intake normalizes Plaud OGG to a single-stream MP3", async () => {
  const dir = await mkdtemp(join(tmpdir(), "y2t-intake-audio-"));
  const input = join(dir, "intake.ogg");
  await writeFile(input, "immutable-ogg-source", "utf8");
  let observedArgs: string[] = [];

  try {
    const output = await prepareIntakeAudioForProvider(
      input,
      "audio/ogg; codecs=opus",
      {
        ffmpegPath: "/usr/bin/ffmpeg",
        run: async (command, args) => {
          assert.equal(command, "/usr/bin/ffmpeg");
          observedArgs = args;
          await writeFile(args.at(-1)!, "normalized-mp3", "utf8");
          return { stdout: "", stderr: "", exitCode: 0 };
        },
      }
    );

    assert.equal(output, join(dir, "intake.provider.mp3"));
    assert.equal(await readFile(input, "utf8"), "immutable-ogg-source");
    assert.equal(await readFile(output, "utf8"), "normalized-mp3");
    assert.deepEqual(observedArgs.slice(observedArgs.indexOf("-map"), -1), [
      "-map",
      "0:a:0",
      "-vn",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "64k",
      "-f",
      "mp3",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

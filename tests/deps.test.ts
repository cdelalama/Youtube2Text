import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  validateFfmpegInstalled,
  validateFfprobeInstalled,
} from "../src/utils/deps.js";

test("ffmpeg tools are probed with their supported -version flag", async () => {
  const dir = await mkdtemp(join(tmpdir(), "y2t-ffmpeg-probe-"));
  const tool = join(dir, "ffmpeg-probe");
  await writeFile(tool, "#!/bin/sh\n[ \"$1\" = \"-version\" ]\n", "utf8");
  await chmod(tool, 0o755);

  try {
    assert.equal(await validateFfmpegInstalled(tool), tool);
    assert.equal(await validateFfprobeInstalled(tool), tool);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

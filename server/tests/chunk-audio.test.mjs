import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { tsImport } from "tsx/esm/api";

const { chunkAudio } = await tsImport("../src/transcription/chunk-audio.ts", import.meta.url);

const exec = promisify(execFile);

for (const rate of [8000, 44100]) {
  test(`decoded chunk timestamps match source markers at ${rate} Hz`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "podsub-chunks-test-"));
    try {
      const source = path.join(dir, "source.wav");
      // Markers safely inside each segment, including a legitimate short ending.
      const markers = [0.4, 2.4, 4.4, 6.1];
      const windows = markers.map((t) => `between(t,${t},${t + 0.08})`).join("+");
      await exec("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `aevalsrc='0.5*sin(2*PI*440*t)*(${windows})':s=${rate}:d=6.3`,
        source,
      ]);
      const chunks = await chunkAudio(source, dir, 2);
      assert.equal(chunks.length, 4, "retain the short final speech chunk");
      assert.equal(chunks[0].offset, 0);
      assert.ok(Math.abs(chunks[1].offset - 2) > 0.001, "do not assume ideal boundaries");
      for (const [i, chunk] of chunks.entries()) {
        const { stdout } = await exec(
          "ffmpeg",
          ["-v", "error", "-i", chunk.file, "-ac", "1", "-f", "f32le", "pipe:1"],
          { encoding: "buffer", maxBuffer: 2 * 1024 * 1024 },
        );
        let onset = -1;
        for (let sample = 0; sample < stdout.length / 4; sample++) {
          if (Math.abs(stdout.readFloatLE(sample * 4)) > 0.05) {
            onset = sample / rate;
            break;
          }
        }
        assert.ok(onset >= 0, `marker exists in chunk ${i}`);
        assert.ok(
          Math.abs(chunk.offset + onset - markers[i]) < 0.005,
          `chunk ${i}: ${chunk.offset + onset} should match ${markers[i]}`,
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("ignore an undecodable trailing MP3 flush fragment", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "podsub-fragment-test-"));
  try {
    const source = path.join(dir, "source.wav");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=sample_rate=44100:duration=6",
      source,
    ]);
    const chunks = await chunkAudio(source, dir, 2);
    assert.equal(chunks.length, 3);
    // Also exercise an input shorter than one second: it must not be filtered out.
    const shortDir = path.join(dir, "short");
    await mkdir(shortDir);
    const short = path.join(dir, "short.wav");
    await exec("ffmpeg", ["-v", "error", "-i", source, "-t", "0.3", short]);
    assert.equal((await chunkAudio(short, shortDir, 2)).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

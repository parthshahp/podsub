import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import { audioEtag } from "./audio-cache.js";

const execFileP = promisify(execFile);

// Line clips are seconds long; the cap also bounds ffmpeg work per request.
export const MAX_CLIP_SECONDS = 60;

// Encoded 60 s at 128 kbit/s is ~1 MB; headroom to fail fast on surprises.
const FFMPEG_MAX_BUFFER = 15 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 30_000;

export function clipEtag(
  audioUrl: string,
  size: number,
  mtimeMs: number,
  start: number,
  end: number,
): string {
  const h = createHash("sha256");
  h.update(audioEtag(audioUrl, size, mtimeMs));
  h.update(`:mp3-128k-v1:${start}:${end}`);
  return `"${h.digest("hex").slice(0, 32)}"`;
}

/** Slice [startSec, endSec) out of a cached file as 128 kbit/s MP3. */
export async function cutAudioClip(
  file: string,
  startSec: number,
  endSec: number,
): Promise<Buffer> {
  const duration = endSec - startSec;
  const { stdout } = await execFileP(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      String(startSec),
      "-i",
      file,
      "-t",
      String(duration),
      "-vn",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "-f",
      "mp3",
      "pipe:1",
    ],
    {
      encoding: "buffer",
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: FFMPEG_MAX_BUFFER,
    },
  );
  return stdout as Buffer;
}

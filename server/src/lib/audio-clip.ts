import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { EpisodeRow } from "../db/queries";
import {
  audioFileFor,
  ensurePodcastsDir,
  pipeToFileAtomically,
  releaseAudio,
  resolveCachedAudio,
  retainAudio,
  type CachedAudio,
} from "./audio-cache";
import { safeFetch } from "./safe-fetch";

const execFileP = promisify(execFile);

const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
const AUDIO_TIMEOUT_MS = 30_000;

// Line clips are seconds long; the cap also bounds ffmpeg work per request.
export const MAX_CLIP_SECONDS = 60;

// Encoded 60 s at 128 kbit/s is ~1 MB; headroom to fail fast on surprises.
const FFMPEG_MAX_BUFFER = 15 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 30_000;

/** Resolve cached audio, downloading it first on a cold cache (atomically). */
export async function ensureCachedAudioFile(episode: EpisodeRow): Promise<CachedAudio> {
  const hit = resolveCachedAudio(episode.id);
  if (hit) return hit;

  retainAudio(episode.id);
  try {
    const head = await safeFetch(
      episode.audio_url,
      { method: "HEAD" },
      { timeoutMs: AUDIO_TIMEOUT_MS },
    );
    const file = audioFileFor(episode.id, head.headers.get("content-type"));
    // Re-check after the HEAD: a concurrent download may have finished.
    const raced = resolveCachedAudio(episode.id);
    if (raced) return raced;

    const res = await safeFetch(episode.audio_url, {}, { timeoutMs: AUDIO_TIMEOUT_MS });
    if (!res.ok || !res.body) {
      throw new Error(`Audio download failed with status ${res.status}`);
    }
    await ensurePodcastsDir();
    await pipeToFileAtomically(res.body, file, MAX_AUDIO_BYTES);
    return resolveCachedAudio(episode.id) ?? { file, mime: "audio/mpeg" };
  } finally {
    releaseAudio(episode.id);
  }
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

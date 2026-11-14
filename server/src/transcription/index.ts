import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { CHUNK_DELAY_MS, CHUNK_SECONDS, MODEL } from "../config.js";
import { ensureCachedAudioFile, releaseAudio, retainAudio } from "../lib/audio-cache.js";
import { saveTranscript, type EpisodeRow } from "../db/queries.js";

const execFileP = promisify(execFile);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import type { Word, Transcript } from "@podsub/schemas";
import { groupWordsIntoLines } from "../lib/transcript-text.js";
export { appendWordToLine, groupWordsIntoLines } from "../lib/transcript-text.js";

async function transcribeChunk(
  apiKey: string,
  file: string,
  model: string,
): Promise<{ words?: Word[]; language?: string }> {
  const audio = await readFile(file);
  const res = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input_audio: { data: audio.toString("base64"), format: "mp3" },
      response_format: "verbose_json",
      timestamp_granularities: ["segment", "word"],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// Always re-encoded to mp3, so any ffmpeg-readable input format works.
async function chunkAudio(file: string, dir: string): Promise<string[]> {
  await execFileP("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    file,
    // Drop cover art / video streams and keep the first audio stream only:
    // otherwise the segment muxer re-muxes the JPEG into every chunk,
    // inflating each request ~2× and tripping the provider's size gate.
    "-vn",
    "-map",
    "0:a:0",
    "-f",
    "segment",
    "-segment_time",
    String(CHUNK_SECONDS),
    "-c:a",
    "libmp3lame",
    "-b:a",
    "64k",
    path.join(dir, "chunk%03d.mp3"),
  ]);
  return (await readdir(dir)).filter((f) => f.endsWith(".mp3")).sort();
}

/** Download (cached) → chunk with ffmpeg → transcribe via OpenRouter → persist. */
export async function transcribeEpisode(
  episode: EpisodeRow,
  model: string = MODEL,
): Promise<Transcript> {
  // Hold the cache file so eviction can't delete it mid-pipeline.
  retainAudio(episode.id);
  try {
    return await transcribeEpisodeInner(episode, model);
  } finally {
    releaseAudio(episode.id);
  }
}

async function transcribeEpisodeInner(episode: EpisodeRow, model: string): Promise<Transcript> {
  const { file } = await ensureCachedAudioFile(episode);
  console.log(`Transcribing ${file} with ${model}...`);

  const dir = await mkdtemp(path.join(tmpdir(), "podsub-"));
  try {
    const files = await chunkAudio(file, dir);
    const words: Word[] = [];
    let language: string | null = null;

    for (const [i, file] of files.entries()) {
      if (i > 0) await sleep(CHUNK_DELAY_MS);
      console.log(`Transcribing chunk ${i + 1}/${files.length}...`);
      const data = await transcribeChunk(
        process.env.OPENROUTER_API_KEY ?? "",
        path.join(dir, file),
        model,
      );
      language ??= data.language ?? null;
      const offset = i * CHUNK_SECONDS;
      for (const w of data.words ?? []) {
        words.push({ word: w.word, start: w.start + offset, end: w.end + offset });
      }
    }

    const updatedAt = saveTranscript(episode.id, model, language, words);
    const result: Transcript = {
      model,
      updatedAt,
      words,
      lines: groupWordsIntoLines(words),
    };
    console.log(`Transcription complete for episode ${episode.id}`);
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

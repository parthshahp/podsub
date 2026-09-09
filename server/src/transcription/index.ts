import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { CHUNK_DELAY_MS, CHUNK_SECONDS, MAX_LINE_SECONDS, MODEL } from "../config.js";
import {
  audioFileFor,
  ensurePodcastsDir,
  pipeToFileAtomically,
  releaseAudio,
  resolveCachedAudio,
  retainAudio,
} from "../lib/audio-cache.js";
import { safeFetch } from "../lib/safe-fetch.js";
import { saveTranscript, type EpisodeRow } from "../db/queries.js";

const execFileP = promisify(execFile);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import type { Word, Transcript } from "@podsub/schemas";

// Consecutive Han/Kana/Hangul words must not get spaces inserted between them.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
// Punctuation hugs the preceding word; straight quotes are ambiguous and left out.
const NO_SPACE_BEFORE = /^[,.;:!?%)\]}'”’、。，！？：；…]/;
// Unambiguous openers hug the following word.
const NO_SPACE_AFTER = /[([{'“‘（「『]$/;

/** Join one ASR word into the accumulating line text, spacing Latin runs only. */
export function appendWordToLine(text: string, word: string): string {
  if (!text) return word;
  if (/^\s/.test(word) || /\s$/.test(text)) return text + word;
  if (NO_SPACE_BEFORE.test(word)) return text + word;
  if (NO_SPACE_AFTER.test(text)) return text + word;
  if (CJK.test(text.at(-1) ?? "") && CJK.test(word[0] ?? "")) return text + word;
  return text + " " + word;
}

export function groupWordsIntoLines(words: Word[]): { start: number; text: string }[] {
  const lines: { start: number; text: string }[] = [];
  let text = "";
  let lineStart = 0;
  for (const w of words) {
    if (!text) lineStart = w.start;
    text = appendWordToLine(text, w.word);
    if (/[。！？！？.!?]/.test(w.word) || w.end - lineStart > MAX_LINE_SECONDS) {
      lines.push({ start: lineStart, text });
      text = "";
    }
  }
  if (text) lines.push({ start: lineStart, text });
  return lines;
}

// 500 MB caps disk use; the timeout applies to response headers only.
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
const AUDIO_TIMEOUT_MS = 30_000;

async function downloadAudio(episode: EpisodeRow): Promise<string> {
  // Cache hit first: skips the HEAD entirely, so a slow upstream can't time
  // out an episode whose audio is already on disk.
  const cached = resolveCachedAudio(episode.id);
  if (cached) {
    console.log(`Audio already downloaded: ${cached.file}`);
    return cached.file;
  }

  const head = await safeFetch(
    episode.audio_url,
    { method: "HEAD" },
    { timeoutMs: AUDIO_TIMEOUT_MS },
  );
  const file = audioFileFor(episode.id, head.headers.get("content-type"));

  if (existsSync(file)) {
    console.log(`Audio already downloaded: ${file}`);
    return file;
  }

  console.log(`Downloading ${episode.audio_url} -> ${file}...`);
  const res = await safeFetch(episode.audio_url, {}, { timeoutMs: AUDIO_TIMEOUT_MS });
  if (!res.ok || !res.body) {
    throw new Error(`Audio download failed with status ${res.status}`);
  }
  // Atomic temp-then-rename write.
  await ensurePodcastsDir();
  await pipeToFileAtomically(res.body, file, MAX_AUDIO_BYTES);
  return file;
}

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
export async function transcribeEpisode(episode: EpisodeRow, model: string = MODEL): Promise<Transcript> {
  // Hold the cache file so eviction can't delete it mid-pipeline.
  retainAudio(episode.id);
  try {
    return await transcribeEpisodeInner(episode, model);
  } finally {
    releaseAudio(episode.id);
  }
}

async function transcribeEpisodeInner(episode: EpisodeRow, model: string): Promise<Transcript> {
  const file = await downloadAudio(episode);
  console.log(`Transcribing ${file} with ${model}...`);

  const dir = await mkdtemp(path.join(tmpdir(), "podsub-"));
  try {
    const files = await chunkAudio(file, dir);
    const words: Word[] = [];
    let language: string | null = null;

    for (let i = 0; i < files.length; i++) {
      if (i > 0) await sleep(CHUNK_DELAY_MS);
      console.log(`Transcribing chunk ${i + 1}/${files.length}...`);
      const data = await transcribeChunk(
        process.env.OPENROUTER_API_KEY ?? "",
        path.join(dir, files[i]),
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

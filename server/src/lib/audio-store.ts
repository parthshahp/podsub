import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { cappedBodyStream, safeFetch } from "./safe-fetch.js";

type AudioEpisode = { id: string; audio_url: string };
export type CachedAudio = { file: string; mime: string };
type AudioSource =
  | { kind: "cached"; audio: CachedAudio }
  | { kind: "upstream"; response: Response };

export const AUDIO_MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".wav": "audio/wav",
  ".bin": "application/octet-stream",
};

function extensionFor(contentType: string | null): string {
  if (contentType?.includes("mpeg")) return ".mp3";
  if (contentType?.includes("mp4") || contentType?.includes("m4a")) return ".m4a";
  if (contentType?.includes("ogg")) return ".ogg";
  if (contentType?.includes("wav")) return ".wav";
  return ".bin";
}

/** Shared cold-cache work for playback, clipping and transcription. */
export function createAudioStore({
  directory,
  fetchAudio = safeFetch,
  maxBytes = 500 * 1024 * 1024,
  onError = (error: unknown) => console.error("Audio cache download failed:", error),
}: {
  directory: string;
  fetchAudio?: typeof safeFetch;
  maxBytes?: number;
  onError?: (error: unknown) => void;
}) {
  const pending = new Map<string, Promise<CachedAudio | null>>();
  const holds = new Map<string, number>();

  function retain(id: string) {
    holds.set(id, (holds.get(id) ?? 0) + 1);
  }

  function release(id: string) {
    const count = holds.get(id) ?? 0;
    if (count <= 1) holds.delete(id);
    else holds.set(id, count - 1);
  }

  function key(episode: AudioEpisode) {
    const hash = createHash("sha256").update(episode.audio_url).digest("hex").slice(0, 32);
    return `${episode.id}.${hash}`;
  }

  function resolve(episode: AudioEpisode): CachedAudio | null {
    const prefix = key(episode);
    for (const [ext, mime] of Object.entries(AUDIO_MIME_TYPES)) {
      const file = path.join(directory, prefix + ext);
      if (existsSync(file)) return { file, mime };
    }
    return null;
  }

  async function write(body: ReadableStream<Uint8Array>, file: string) {
    const tmp = `${file}.${randomUUID()}.part`;
    try {
      await mkdir(directory, { recursive: true });
      await pipeline(
        Readable.fromWeb(body as unknown as NodeReadableStream),
        createWriteStream(tmp, { flags: "wx" }),
      );
      await rename(tmp, file);
    } catch (error) {
      await body.cancel().catch(() => {});
      await rm(tmp, { force: true });
      throw error;
    }
  }

  // Register before awaiting headers. A range request may yield 206, in which
  // case no complete file is published and waiting consumers retry normally.
  function start(
    episode: AudioEpisode,
    init: RequestInit = {},
    respond?: (response: Response) => void,
  ): Promise<CachedAudio | null> {
    const cacheKey = key(episode);
    retain(episode.id);
    const download = (async () => {
      const res = await fetchAudio(episode.audio_url, init, { timeoutMs: 30_000 });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`Audio download failed with status ${res.status}`);
      }
      if (init.method === "HEAD" || (respond && res.status === 206)) {
        respond?.(res);
        return null;
      }
      if (res.status !== 200 || !res.body) {
        await res.body?.cancel().catch(() => {});
        throw new Error("Expected a complete audio response");
      }
      let body: ReadableStream<Uint8Array>;
      try {
        body = cappedBodyStream(res, maxBytes);
      } catch (error) {
        await res.body.cancel().catch(() => {});
        throw error;
      }
      const ext = extensionFor(res.headers.get("content-type"));
      const audio = { file: path.join(directory, cacheKey + ext), mime: AUDIO_MIME_TYPES[ext]! };
      if (respond) {
        const [client, disk] = body.tee();
        body = disk;
        respond(new Response(client, { status: 200, headers: res.headers }));
      }
      await write(body, audio.file);
      return audio;
    })().finally(() => {
      pending.delete(cacheKey);
      release(episode.id);
    });
    pending.set(cacheKey, download);
    return download;
  }

  async function ensure(episode: AudioEpisode): Promise<CachedAudio> {
    const hit = resolve(episode);
    if (hit) return hit;
    const audio = await (pending.get(key(episode)) ?? start(episode));
    return audio ?? ensure(episode);
  }

  async function open(episode: AudioEpisode, init: RequestInit = {}): Promise<AudioSource> {
    const hit = resolve(episode);
    if (hit) return { kind: "cached", audio: hit };
    const existing = pending.get(key(episode));
    if (existing) {
      await existing;
      return open(episode, init);
    }
    // Only the initiating player owns the live stream. Other consumers join
    // its completed file rather than creating another download or stream tee.
    const response = await new Promise<Response>((resolve, reject) => {
      void start(episode, init, resolve).catch((error) => {
        reject(error);
        onError(error);
      });
    });
    return { kind: "upstream", response };
  }

  return { resolve, ensure, open, retain, release, isActive: (id: string) => holds.has(id) };
}

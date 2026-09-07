import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { Context } from "hono";

import { AUDIO_CACHE_TTL_MS, PODCASTS_DIR } from "../config.js";
import type { EpisodeRow } from "../db/queries.js";
import { cappedBodyStream, safeFetch } from "./safe-fetch.js";

// Extension only matters for naming; chunking re-encodes to mp3 and the audio
// endpoint maps extensions back to MIME types.
export function extensionFor(contentType: string | null): string {
  if (contentType?.includes("mpeg")) return ".mp3";
  if (contentType?.includes("mp4") || contentType?.includes("m4a")) return ".m4a";
  if (contentType?.includes("ogg")) return ".ogg";
  if (contentType?.includes("wav")) return ".wav";
  return ".bin";
}

const MIME_FOR_EXT: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".wav": "audio/wav",
  ".bin": "application/octet-stream",
};

export function audioFileFor(episodeId: string, contentType: string | null): string {
  return path.join(PODCASTS_DIR, episodeId + extensionFor(contentType));
}

/** Create the (gitignored) audio cache directory if it isn't there yet. */
export async function ensurePodcastsDir(): Promise<void> {
  await mkdir(PODCASTS_DIR, { recursive: true });
}

export type CachedAudio = { file: string; mime: string };

/** Resolve cached audio for an episode by probing the known extensions. */
export function resolveCachedAudio(episodeId: string): CachedAudio | null {
  for (const [ext, mime] of Object.entries(MIME_FOR_EXT)) {
    const file = path.join(PODCASTS_DIR, episodeId + ext);
    if (existsSync(file)) return { file, mime };
  }
  return null;
}

/** ETag over the upstream URL plus on-disk bytes, so an enclosure change revalidates. */
function audioEtag(audioUrl: string, size: number | null, mtimeMs: number | null): string {
  const h = createHash("sha256");
  h.update(audioUrl);
  if (size !== null) h.update(`:${size}:${mtimeMs}`);
  return `"${h.digest("hex").slice(0, 32)}"`;
}

/** Write a stream to `file` atomically (temp + rename). */
export async function pipeToFileAtomically(
  body: ReadableStream<Uint8Array>,
  file: string,
  maxBytes: number,
): Promise<void> {
  const tmp = `${file}.${process.pid}.part`;
  try {
    await pipeline(
      Readable.fromWeb(
        cappedBodyStream(new Response(body), maxBytes) as unknown as NodeReadableStream,
      ),
      createWriteStream(tmp),
    );
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Serve a fully-downloaded episode file with seeking + revalidation support. */
export async function serveCachedAudio(
  c: Context,
  episode: EpisodeRow,
  hit: CachedAudio,
): Promise<Response> {
  markAudioServed(episode.id);
  const st = await stat(hit.file);
  const etag = audioEtag(episode.audio_url, st.size, st.mtimeMs);
  const baseHeaders = {
    "content-type": hit.mime,
    "accept-ranges": "bytes",
    etag,
    "cache-control": "public, max-age=31536000", // revalidated via ETag
  };

  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: baseHeaders });
  }
  if (c.req.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { ...baseHeaders, "content-length": String(st.size) },
    });
  }

  // <audio> seeks with single-range requests; anything else gets the whole file.
  const range = c.req.header("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] !== "" || m[2] !== "")) {
    let start = m[1] === "" ? NaN : Number(m[1]);
    let end = m[2] === "" ? NaN : Number(m[2]);
    if (Number.isNaN(start)) {
      // Suffix range ("last N bytes").
      if (Number.isNaN(end) || end <= 0) {
        return new Response(null, {
          status: 416,
          headers: { "content-range": `bytes */${st.size}` },
        });
      }
      start = Math.max(0, st.size - end);
      end = st.size - 1;
    } else {
      if (Number.isNaN(end) || end >= st.size) end = st.size - 1;
      if (start >= st.size || start > end) {
        return new Response(null, {
          status: 416,
          headers: { "content-range": `bytes */${st.size}` },
        });
      }
    }
    const stream = Readable.toWeb(createReadStream(hit.file, { start, end }));
    return new Response(stream as unknown as BodyInit, {
      status: 206,
      headers: {
        ...baseHeaders,
        "content-length": String(end - start + 1),
        "content-range": `bytes ${start}-${end}/${st.size}`,
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(hit.file));
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: { ...baseHeaders, "content-length": String(st.size) },
  });
}

// 500 MB covers any real episode and stops hostile feeds from filling the disk.
// The timeout applies to response headers only, not the body stream.
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
const AUDIO_TIMEOUT_MS = 30_000;

/**
 * Cold-cache fallback: stream the upstream enclosure through to the client,
 * teeing a full (200) response to disk so it's only ever downloaded once.
 */
export async function proxyUpstreamAudio(c: Context, episode: EpisodeRow): Promise<Response> {
  const clientRange = c.req.header("range") ?? undefined;
  let upstream: Response;
  try {
    upstream = await safeFetch(
      episode.audio_url,
      {
        ...(c.req.method === "HEAD" ? { method: "HEAD" } : {}),
        ...(clientRange ? { headers: { range: clientRange } } : {}),
      },
      { timeoutMs: AUDIO_TIMEOUT_MS },
    );
  } catch (err) {
    console.error(`Audio proxy fetch failed for episode ${episode.id}:`, err);
    return c.json({ error: "Upstream audio fetch failed" }, 502);
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel().catch(() => {});
    return c.json({ error: "Upstream audio fetch failed" }, 502);
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  // No size/mtime yet — the URL hash still busts caches when the enclosure changes.
  const etag = audioEtag(episode.audio_url, null, null);
  if (c.req.header("if-none-match") === etag) {
    await upstream.body.cancel().catch(() => {});
    return new Response(null, { status: 304, headers: { etag } });
  }

  if (upstream.status === 206) {
    const headers: Record<string, string> = {
      "content-type": contentType,
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=86400",
      etag,
    };
    for (const h of ["content-length", "content-range"]) {
      const v = upstream.headers.get(h);
      if (v) headers[h] = v;
    }
    if (c.req.method === "HEAD") {
      await upstream.body.cancel().catch(() => {});
      return new Response(null, { status: 206, headers });
    }
    return new Response(upstream.body, { status: 206, headers });
  }

  // Tee one branch to disk in the background; it keeps pulling even if the
  // client disconnects, so abandoned playback still warms the cache.
  const headers: Record<string, string> = {
    "content-type": contentType,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=86400",
    etag,
  };
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers["content-length"] = contentLength;
  if (c.req.method === "HEAD") {
    await upstream.body.cancel().catch(() => {});
    return new Response(null, { status: 200, headers });
  }

  const [forClient, forDisk] = upstream.body.tee();
  const file = audioFileFor(episode.id, contentType);
  void (async () => {
    retainAudio(episode.id);
    try {
      await ensurePodcastsDir();
      await pipeToFileAtomically(forDisk, file, MAX_AUDIO_BYTES);
      console.log(`Cached ${episode.audio_url} -> ${file}`);
    } catch (err) {
      await forDisk.cancel().catch(() => {});
      console.error(`Audio cache write failed for episode ${episode.id}:`, err);
    } finally {
      releaseAudio(episode.id);
    }
  })();
  return new Response(forClient, { status: 200, headers });
}

// --- Eviction ---

// In-flight download/transcription ids; the sweep never deletes these.
const activeAudio = new Set<string>();

export function retainAudio(episodeId: string): void {
  activeAudio.add(episodeId);
}

export function releaseAudio(episodeId: string): void {
  activeAudio.delete(episodeId);
}

// Last-serve timestamps; mtime alone would only record the download.
const servedAt = new Map<string, number>();

function markAudioServed(episodeId: string): void {
  servedAt.set(episodeId, Date.now());
  if (servedAt.size > 10_000) servedAt.clear();
}

// Crash-orphaned partial downloads are reaped aggressively.
const PART_ORPHAN_MS = 60 * 60 * 1000;

// Temp files: `<episodeId>.<ext>.<pid>.part`; ids are UUIDs (no dots).
function episodeIdForEntry(entry: string): string | null {
  const m = /^(.+)\.[^.]+\.\d+\.part$/.exec(entry);
  if (m) return m[1];
  const dot = entry.indexOf(".");
  return dot === -1 ? null : entry.slice(0, dot);
}

/** Delete cached audio untouched for longer than its TTL. Returns what was removed. */
export async function sweepAudioCache(now = Date.now()): Promise<{ deleted: string[] }> {
  const deleted: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(PODCASTS_DIR);
  } catch {
    return { deleted }; // cache dir doesn't exist yet — nothing to do
  }
  for (const entry of entries) {
    const isPart = entry.endsWith(".part");
    if (!isPart && !(path.extname(entry) in MIME_FOR_EXT)) continue; // not ours
    const id = episodeIdForEntry(entry);
    if (id !== null && activeAudio.has(id)) continue;
    const file = path.join(PODCASTS_DIR, entry);
    const st = await stat(file).catch(() => null);
    if (!st) continue;
    const ttl = isPart ? PART_ORPHAN_MS : AUDIO_CACHE_TTL_MS;
    const lastUse = Math.max(st.mtimeMs, id !== null ? (servedAt.get(id) ?? 0) : 0);
    if (now - lastUse < ttl) continue;
    await rm(file, { force: true });
    if (id !== null) servedAt.delete(id);
    deleted.push(entry);
  }
  return { deleted };
}

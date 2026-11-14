import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { Context } from "hono";

import { AUDIO_CACHE_TTL_MS, PODCASTS_DIR } from "../config.js";
import type { EpisodeRow } from "../db/queries.js";
import { AUDIO_MIME_TYPES, createAudioStore, type CachedAudio } from "./audio-store.js";

const audioStore = createAudioStore({ directory: PODCASTS_DIR });
export const resolveCachedAudio = audioStore.resolve;
export const ensureCachedAudioFile = audioStore.ensure;
export const retainAudio = audioStore.retain;
export const releaseAudio = audioStore.release;
export type { CachedAudio } from "./audio-store.js";

/** Validator for the current local source (not an upstream freshness check). */
export function audioEtag(audioUrl: string, size: number, mtimeMs: number): string {
  const h = createHash("sha256");
  h.update(audioUrl);
  h.update(`:${size}:${mtimeMs}`);
  return `"${h.digest("hex").slice(0, 32)}"`;
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
    "cache-control": "public, no-cache", // Store, but validate before reuse.
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

/**
 * Cold-cache fallback: stream the upstream enclosure through to the client,
 * teeing a full (200) response to disk so it's only ever downloaded once.
 */
export async function proxyUpstreamAudio(c: Context, episode: EpisodeRow): Promise<Response> {
  const clientRange = c.req.header("range") ?? undefined;
  let upstream: Response;
  try {
    const source = await audioStore.open(episode, {
      ...(c.req.method === "HEAD" ? { method: "HEAD" } : {}),
      ...(clientRange ? { headers: { range: clientRange } } : {}),
    });
    if (source.kind === "cached") return serveCachedAudio(c, episode, source.audio);
    upstream = source.response;
  } catch (err) {
    console.error(`Audio proxy fetch failed for episode ${episode.id}:`, err);
    return c.json({ error: "Upstream audio fetch failed" }, 502);
  }
  if (!upstream.ok || (c.req.method !== "HEAD" && !upstream.body)) {
    void upstream.body?.cancel().catch(() => {});
    return c.json({ error: "Upstream audio fetch failed" }, 502);
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  // No local file identity yet. A URL-only validator could incorrectly return
  // 304 after eviction and an upstream replacement at the same URL.
  if (upstream.status === 206) {
    const headers: Record<string, string> = {
      "content-type": contentType,
      "accept-ranges": "bytes",
      "cache-control": "public, no-cache",
    };
    for (const h of ["content-length", "content-range"]) {
      const v = upstream.headers.get(h);
      if (v) headers[h] = v;
    }
    if (c.req.method === "HEAD") {
      await upstream.body?.cancel().catch(() => {});
      return new Response(null, { status: 206, headers });
    }
    return new Response(upstream.body, { status: 206, headers });
  }

  // The shared store owns the background cache write, independently of the client.
  const headers: Record<string, string> = {
    "content-type": contentType,
    "accept-ranges": "bytes",
    "cache-control": "public, no-cache",
  };
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers["content-length"] = contentLength;
  if (c.req.method === "HEAD") {
    await upstream.body?.cancel().catch(() => {});
    return new Response(null, { status: 200, headers });
  }

  return new Response(upstream.body, { status: 200, headers });
}

// --- Eviction ---

// Last-serve timestamps; mtime alone would only record the download.
const servedAt = new Map<string, number>();

function markAudioServed(episodeId: string): void {
  servedAt.set(episodeId, Date.now());
  if (servedAt.size > 10_000) servedAt.clear();
}

// Crash-orphaned partial downloads are reaped aggressively.
const PART_ORPHAN_MS = 60 * 60 * 1000;

// Both source-versioned files and legacy cache entries start with the episode id.
function episodeIdForEntry(entry: string): string | null {
  const dot = entry.indexOf(".");
  return dot === -1 ? null : entry.slice(0, dot);
}

/** Delete every cached audio file (plus orphaned .part files) for an episode. */
export async function deleteCachedAudio(episodeId: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(PODCASTS_DIR);
  } catch {
    return; // cache dir doesn't exist yet — nothing to do
  }
  await Promise.all(
    entries
      .filter(
        (e) =>
          e.startsWith(`${episodeId}.`) &&
          (e.endsWith(".part") || path.extname(e) in AUDIO_MIME_TYPES),
      )
      .map((e) => rm(path.join(PODCASTS_DIR, e), { force: true })),
  );
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
    if (!isPart && !(path.extname(entry) in AUDIO_MIME_TYPES)) continue; // not ours
    const id = episodeIdForEntry(entry);
    if (id !== null && audioStore.isActive(id)) continue;
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

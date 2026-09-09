import { Hono } from "hono";
import sharp from "sharp";

import {
  episodeListItemFromRow,
  getPodcast,
  listEpisodes,
  listPodcasts,
  podcastFromRow,
} from "../db/queries.js";
import { importFeed } from "../feeds/importer.js";
import { CreatePodcastInputSchema } from "@podsub/schemas";
import type { PodcastDetail } from "@podsub/schemas";
import { cappedBodyStream, readBodyCapped, safeFetch } from "../lib/safe-fetch.js";
import { getTranscribeStatus } from "../transcription/jobs.js";
import { listEpisodesValidator } from "./episodes.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Thumbnail buckets the UI may request via ?size=. Fixed buckets (instead
// of arbitrary widths) keep the resize cache bounded and prevent
// cache-busting abuse — ?size=200 snaps to 256, ?size=1000 snaps to 512.
const IMAGE_SIZES = [96, 256, 512] as const;
const THUMB_TTL_MS = 24 * 60 * 60 * 1000;
const THUMB_CACHE_MAX = 200;

// Resized artwork buffers keyed by podcast + size + upstream URL (the URL is
// part of the key so a feed re-import with new art doesn't serve stale
// thumbnails). Small podcast counts make an in-process LRU plenty.
const thumbCache = new Map<string, { buf: Buffer; expires: number }>();

function getThumb(key: string): Buffer | undefined {
  const hit = thumbCache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    thumbCache.delete(key);
    return undefined;
  }
  // Refresh LRU order.
  thumbCache.delete(key);
  thumbCache.set(key, hit);
  return hit.buf;
}

function setThumb(key: string, buf: Buffer): void {
  if (thumbCache.has(key)) thumbCache.delete(key);
  while (thumbCache.size >= THUMB_CACHE_MAX) {
    const oldest = thumbCache.keys().next();
    if (oldest.done) break;
    thumbCache.delete(oldest.value);
  }
  thumbCache.set(key, { buf, expires: Date.now() + THUMB_TTL_MS });
}

/** Snap a requested size to the nearest bucket (rounds up, caps at max). */
function snapSize(requested: number): number {
  for (const s of IMAGE_SIZES) {
    if (requested <= s) return s;
  }
  return IMAGE_SIZES[IMAGE_SIZES.length - 1];
}

export const podcastRoutes = new Hono()
  .get("/", (c) => c.json(listPodcasts()))
  .post("/", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const input = CreatePodcastInputSchema.safeParse(body);
    if (!input.success) {
      return c.json({ error: "Expected body { feedUrl: string }" }, 400);
    }

    try {
      const podcast = await importFeed(input.data.feedUrl);
      return c.json(podcast, 201);
    } catch (err) {
      // Log detail, return generic — err messages can leak internal hostnames.
      console.error("Feed import failed:", err);
      return c.json({ error: "Could not import feed" }, 400);
    }
  })
  .get("/:id", listEpisodesValidator, (c) => {
    const query = c.req.valid("query");

    const podcast = getPodcast(c.req.param("id"));
    if (!podcast) return c.json({ error: "Not found" }, 404);

    const { rows, total } = listEpisodes({ podcastId: podcast.id, ...query });
    const detail: PodcastDetail = {
      podcast: podcastFromRow(podcast),
      episodes: rows.map((row) => episodeListItemFromRow(row, getTranscribeStatus(row.id))),
      total,
      limit: query.limit,
      offset: query.offset,
    };
    return c.json(detail);
  })
  .get("/:id/image", async (c) => {
    // Artwork proxy: CDNs rarely send CORS headers, and feed-supplied
    // originals are 1400-3000px (hundreds of KB+). The UI requests
    // ?size= to get a small progressive JPEG; the bare URL streams the
    // original for Anki media. safeFetch blocks private networks per hop
    // and the body is capped.
    const podcast = getPodcast(c.req.param("id"));
    if (!podcast?.image_url) return c.json({ error: "Not found" }, 404);

    const sizeParam = c.req.query("size");
    if (sizeParam !== undefined) {
      const requested = Number(sizeParam);
      if (!Number.isInteger(requested) || requested <= 0 || requested > 1024) {
        return c.json({ error: "Expected ?size=<1-1024>" }, 400);
      }
      const size = snapSize(requested);
      const cacheKey = `${podcast.id}:${size}:${podcast.image_url}`;
      const cached = getThumb(cacheKey);
      if (cached) {
        return new Response(new Uint8Array(cached), {
          headers: {
            "content-type": "image/jpeg",
            "content-length": String(cached.byteLength),
            "cache-control": "public, max-age=86400, stale-while-revalidate=86400",
          },
        });
      }
      try {
        const upstream = await safeFetch(podcast.image_url);
        const type = upstream.headers.get("content-type") ?? "";
        if (!upstream.ok || !upstream.body || !type.startsWith("image/")) {
          return c.json({ error: "Upstream image fetch failed" }, 502);
        }
        const original = await readBodyCapped(upstream, MAX_IMAGE_BYTES);
        const thumb = await sharp(original)
          .resize(size, size, { fit: "cover", position: "centre" })
          .jpeg({ quality: 72, progressive: true })
          .toBuffer();
        setThumb(cacheKey, thumb);
        return new Response(new Uint8Array(thumb), {
          headers: {
            "content-type": "image/jpeg",
            "content-length": String(thumb.byteLength),
            "cache-control": "public, max-age=86400, stale-while-revalidate=86400",
          },
        });
      } catch (err) {
        console.error("Image thumbnail failed:", err);
        return c.json({ error: "Upstream image fetch failed" }, 502);
      }
    }

    try {
      const upstream = await safeFetch(podcast.image_url);
      const type = upstream.headers.get("content-type") ?? "";
      if (!upstream.ok || !upstream.body || !type.startsWith("image/")) {
        return c.json({ error: "Upstream image fetch failed" }, 502);
      }
      return new Response(cappedBodyStream(upstream, MAX_IMAGE_BYTES), {
        headers: {
          "content-type": type,
          "cache-control": "public, max-age=86400",
        },
      });
    } catch (err) {
      console.error("Image proxy failed:", err);
      return c.json({ error: "Upstream image fetch failed" }, 502);
    }
  });

import type Database from "better-sqlite3";

import { readBodyCapped, safeFetch } from "./safe-fetch.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type CachedImage = { contentType: string; data: Buffer };

/** Persistent originals: no expiry or upstream request once an image is saved. */
export function createImageCache(database: Database.Database, fetchImage = safeFetch) {
  const read = database.prepare<[string, string], CachedImage>(`
    SELECT content_type AS contentType, data FROM podcast_image
    WHERE podcast_id = ? AND image_url = ?
  `);
  // A podcast can be deleted or its image URL can change during a download.
  // Only save if the image still belongs to the current podcast row.
  const save = database.prepare(`
    INSERT INTO podcast_image (podcast_id, image_url, content_type, data)
    SELECT id, image_url, ?, ? FROM podcast WHERE id = ? AND image_url = ?
    ON CONFLICT(podcast_id) DO UPDATE SET
      image_url = excluded.image_url,
      content_type = excluded.content_type,
      data = excluded.data
  `);
  const inFlight = new Map<string, Promise<CachedImage>>();

  async function download(podcastId: string, imageUrl: string): Promise<CachedImage> {
    const upstream = await fetchImage(imageUrl);
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !upstream.body || !contentType.startsWith("image/")) {
      await upstream.body?.cancel().catch(() => {});
      throw new Error(`Upstream image fetch failed (HTTP ${upstream.status})`);
    }
    let data: Buffer;
    try {
      data = await readBodyCapped(upstream, MAX_IMAGE_BYTES);
    } catch (err) {
      await upstream.body.cancel().catch(() => {});
      throw err;
    }
    if (data.length === 0) throw new Error("Upstream image is empty");
    save.run(contentType, data, podcastId, imageUrl);
    return { contentType, data };
  }

  return {
    async get(podcastId: string, imageUrl: string): Promise<CachedImage> {
      const cached = read.get(podcastId, imageUrl);
      if (cached) return cached;

      // Thumbnail and original requests often arrive together on a cold cache.
      const key = JSON.stringify([podcastId, imageUrl]);
      let pending = inFlight.get(key);
      if (!pending) {
        pending = download(podcastId, imageUrl);
        inFlight.set(key, pending);
      }
      try {
        return await pending;
      } finally {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      }
    },
  };
}

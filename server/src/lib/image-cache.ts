import type Database from "better-sqlite3";
import sharp from "sharp";

import { readBodyCapped, safeFetch } from "./safe-fetch.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_ENCODING_VERSION = 1;

type CachedImage = { contentType: string; data: Buffer };
type StoredImage = CachedImage & { encodingVersion: number };

/** Persistent, optimized artwork shared by thumbnails and card exports. */
export function createImageCache(database: Database.Database, fetchImage = safeFetch) {
  const read = database.prepare<[string, string], StoredImage>(`
    SELECT content_type AS contentType, data, encoding_version AS encodingVersion FROM podcast_image
    WHERE podcast_id = ? AND image_url = ?
  `);
  // A podcast can be deleted or its image URL can change during a download.
  // Only save if the image still belongs to the current podcast row.
  const save = database.prepare(`
    INSERT INTO podcast_image (podcast_id, image_url, content_type, data, encoding_version)
    SELECT id, image_url, ?, ?, ? FROM podcast WHERE id = ? AND image_url = ?
    ON CONFLICT(podcast_id) DO UPDATE SET
      image_url = excluded.image_url,
      content_type = excluded.content_type,
      data = excluded.data,
      encoding_version = excluded.encoding_version
  `);
  const inFlight = new Map<string, Promise<CachedImage>>();

  async function download(imageUrl: string): Promise<Buffer> {
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
    return data;
  }

  async function load(
    podcastId: string,
    imageUrl: string,
    cached?: StoredImage,
  ): Promise<CachedImage> {
    const source = cached?.data ?? (await download(imageUrl));
    // Bound decoded pixels as well as downloaded bytes. Keep aspect ratio,
    // honor EXIF orientation, strip metadata, and don't enlarge small covers.
    const data = await sharp(source, { limitInputPixels: 25_000_000 })
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer();
    const contentType = "image/jpeg";
    save.run(contentType, data, IMAGE_ENCODING_VERSION, podcastId, imageUrl);
    return { contentType, data };
  }

  return {
    async get(podcastId: string, imageUrl: string): Promise<CachedImage> {
      // Also deduplicate local upgrades of previously saved originals.
      const key = JSON.stringify([podcastId, imageUrl]);
      let pending = inFlight.get(key);
      if (!pending) {
        const cached = read.get(podcastId, imageUrl);
        if (cached?.encodingVersion === IMAGE_ENCODING_VERSION) {
          return { contentType: cached.contentType, data: cached.data };
        }
        pending = load(podcastId, imageUrl, cached);
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

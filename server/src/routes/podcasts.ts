import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  episodeFromRow,
  getPodcast,
  listEpisodesForPodcast,
  listPodcasts,
  podcastFromRow,
} from "../db/queries.js";
import { importFeed } from "../feeds/importer.js";
import { CreatePodcastInputSchema, ListEpisodesQuerySchema } from "@podsub/schemas";
import type { PodcastDetail } from "@podsub/schemas";
import { cappedBodyStream, safeFetch } from "../lib/safe-fetch.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const listEpisodesValidator = zValidator("query", ListEpisodesQuerySchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: "Expected query ?limit=<1-100>&offset=<non-negative int>" }, 400);
  }
});

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

    const { rows, total } = listEpisodesForPodcast(podcast.id, query);
    const detail: PodcastDetail = {
      podcast: podcastFromRow(podcast),
      episodes: rows.map(episodeFromRow),
      total,
      limit: query.limit,
      offset: query.offset,
    };
    return c.json(detail);
  })
  .get("/:id/episodes", listEpisodesValidator, (c) => {
    const query = c.req.valid("query");

    const podcast = getPodcast(c.req.param("id"));
    if (!podcast) return c.json({ error: "Not found" }, 404);

    const { rows, total } = listEpisodesForPodcast(podcast.id, query);
    return c.json({
      episodes: rows.map(episodeFromRow),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  })
  .get("/:id/image", async (c) => {
    // Artwork proxy for Anki media: CDNs rarely send CORS headers. The URL
    // is feed-supplied, so safeFetch blocks private networks per hop and the
    // body is capped.
    const podcast = getPodcast(c.req.param("id"));
    if (!podcast?.image_url) return c.json({ error: "Not found" }, 404);

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

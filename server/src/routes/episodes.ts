import { createHash } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  episodeFromRow,
  getEpisodeWithPodcast,
  getTranscript,
  hasTranscript,
  podcastFromRow,
  setEpisodeArchived,
} from "../db/queries.js";
import { ArchiveEpisodeInputSchema } from "@podsub/schemas";
import { transcribeEpisode } from "../transcription/index.js";
import { cutAudioClip, ensureCachedAudioFile, MAX_CLIP_SECONDS } from "../lib/audio-clip.js";
import {
  proxyUpstreamAudio,
  releaseAudio,
  resolveCachedAudio,
  retainAudio,
  serveCachedAudio,
} from "../lib/audio-cache.js";
import type { EpisodeDetail } from "@podsub/schemas";

// In-memory job registry, keyed by episode id; resets on server restart.
type Job = { status: "queued" | "running" | "done" | "failed"; error?: string };
const jobs = new Map<string, Job>();

// Episode detail + transcript state; the client polls this while a
// transcription job runs.
export const episodeRoutes = new Hono()
  .get("/:id", (c) => {
    const row = getEpisodeWithPodcast(c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);

    // Redundant for the client — the transcript itself is the signal.
    const job = jobs.get(row.episode.id);
    const present = hasTranscript(row.episode.id);
    const detail: EpisodeDetail = {
      podcast: podcastFromRow(row.podcast),
      episode: episodeFromRow({ ...row.episode, has_transcript: present ? 1 : 0 }),
      hasTranscript: present,
      transcribeStatus: !job || job.status === "done" ? "idle" : job.status,
      transcribeError: job?.error ?? null,
    };
    return c.json(detail);
  })
  // Background download + transcription; poll GET /transcript until it 200s.
  .post("/:id/transcribe", (c) => {
    const id = c.req.param("id");
    const row = getEpisodeWithPodcast(id);
    if (!row) return c.json({ error: "Not found" }, 404);

    const job = jobs.get(id);
    if (job && (job.status === "queued" || job.status === "running")) {
      return c.json({ episodeId: id, status: job.status }, 202);
    }

    jobs.set(id, { status: "running" });
    void transcribeEpisode(row.episode)
      .then(() => {
        jobs.set(id, { status: "done" });
      })
      .catch((err) => {
        jobs.set(id, { status: "failed", error: String(err) });
        console.error(`Transcription failed for episode ${id}:`, err);
      });

    return c.json({ episodeId: id, status: "queued" }, 202);
  })
  // Same-origin audio proxy: serves both the <audio> element and export
  // fetches, so playback + clipping share the browser HTTP cache.
  .get("/:id/audio", async (c) => {
    const row = getEpisodeWithPodcast(c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);

    const hit = resolveCachedAudio(row.episode.id);
    if (hit) {
      try {
        return await serveCachedAudio(c, row.episode, hit);
      } catch (err) {
        console.error(`Audio serve failed for episode ${row.episode.id}:`, err);
        return c.json({ error: "Audio read failed" }, 500);
      }
    }
    return proxyUpstreamAudio(c, row.episode);
  })
  // Server-side ffmpeg slice of the cached episode audio, as 128 kbit/s MP3.
  .get("/:id/clip", async (c) => {
    const row = getEpisodeWithPodcast(c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);

    const start = Number(c.req.query("start"));
    const end = Number(c.req.query("end"));
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end - start > MAX_CLIP_SECONDS
    ) {
      return c.json(
        { error: `Invalid clip range: need 0 <= start < end, end - start <= ${MAX_CLIP_SECONDS}s` },
        400,
      );
    }

    // ETag folds in the upstream URL + range, so enclosure changes revalidate.
    const h = createHash("sha256");
    h.update(row.episode.audio_url);
    h.update(`:${start}:${end}`);
    const etag = `"${h.digest("hex").slice(0, 32)}"`;
    if (c.req.header("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag } });
    }

    // Hold the cache file so eviction can't delete it mid-slice.
    retainAudio(row.episode.id);
    try {
      let file: string;
      try {
        file = (await ensureCachedAudioFile(row.episode)).file;
      } catch (err) {
        console.error(`Audio clip fetch failed for episode ${row.episode.id}:`, err);
        return c.json({ error: "Upstream audio fetch failed" }, 502);
      }
      let clip: Buffer;
      try {
        clip = await cutAudioClip(file, start, end);
      } catch (err) {
        console.error(`Audio clip failed for episode ${row.episode.id}:`, err);
        return c.json({ error: "Audio clip failed" }, 500);
      }
      return new Response(new Uint8Array(clip), {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
          "content-length": String(clip.byteLength),
          etag,
          "cache-control": "public, max-age=31536000",
        },
      });
    } finally {
      releaseAudio(row.episode.id);
    }
  })
  .get("/:id/transcript", (c) => {
    const transcript = getTranscript(c.req.param("id"));
    if (!transcript) return c.json({ error: "Not found" }, 404);
    return c.json(transcript);
  })
  // Archive (hide from the default episode list) or un-archive an episode.
  .patch(
    "/:id/archive",
    zValidator("json", ArchiveEpisodeInputSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: "Expected body { archived: boolean }" }, 400);
      }
    }),
    (c) => {
      const id = c.req.param("id");
      const row = getEpisodeWithPodcast(id);
      if (!row) return c.json({ error: "Not found" }, 404);

      const { archived } = c.req.valid("json");
      setEpisodeArchived(id, archived);
      const present = hasTranscript(id);
      return c.json(
        episodeFromRow({
          ...row.episode,
          archived: archived ? 1 : 0,
          has_transcript: present ? 1 : 0,
        }),
      );
    },
  );

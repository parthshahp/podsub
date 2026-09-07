import Parser from "rss-parser";

import { db } from "../db/index.js";
import { podcastFromRow, upsertEpisode, upsertPodcast, type EpisodeInput } from "../db/queries.js";
import type { Podcast } from "@podsub/schemas";
import { readBodyCapped, safeFetch } from "../lib/safe-fetch.js";

// rss-parser maps itunes:* tags automatically; podcast:* needs explicit
// customFields, which also forces the narrow TS generics.
type FeedExtras = {
  language?: string;
  "podcast:guid"?: string;
  "podcast:license"?: string;
};
type ItemExtras = {
  itunes?: { duration?: string };
  "itunes:type"?: string;
};
const parser = new Parser<FeedExtras, ItemExtras>({
  customFields: {
    feed: ["podcast:guid", "podcast:license"],
    item: ["itunes:type"],
  },
});

// itunes:duration: "1234" | "4:56" | "1:02:03".
function parseDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = value.split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function parseDate(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

// Custom/namespaced fields aren't in rss-parser's typed shape.
function customField(obj: unknown, key: string): string | null {
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

// parseURL doesn't follow redirects (many feeds 302 to a CDN), so fetch the
// XML ourselves and hand it to parseString. Feeds are small; cap at 10 MB.
const MAX_FEED_BYTES = 10 * 1024 * 1024;

async function fetchFeedXml(url: string): Promise<string> {
  const res = await safeFetch(url, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
  });
  if (!res.ok) {
    throw new Error(`Feed request failed with status ${res.status}`);
  }
  return (await readBodyCapped(res, MAX_FEED_BYTES)).toString("utf8");
}

/** Fetch an RSS feed and upsert the show + episodes (metadata only, idempotent). */
export async function importFeed(feedUrl: string): Promise<Podcast> {
  const feed = await parser.parseString(await fetchFeedXml(feedUrl));

  const podcastRow = upsertPodcast({
    feed_url: feedUrl,
    guid: customField(feed, "podcast:guid"),
    title: feed.title ?? "Untitled",
    description: feed.description ?? null,
    language: feed.language ?? null,
    author: feed.itunes?.author ?? null,
    image_url: feed.itunes?.image ?? feed.image?.url ?? null,
    license_url: customField(feed, "podcast:license"),
  });

  // One transaction: either the whole feed syncs or none of it does.
  db.transaction(() => {
    for (const item of feed.items) {
      // audio_url is NOT NULL — an item without an enclosure isn't an episode.
      const audioUrl = item.enclosure?.url;
      if (!audioUrl) continue;

      const declaredType = customField(item, "itunes:type");
      const episodeType =
        declaredType === "trailer" || declaredType === "bonus" ? declaredType : "full";

      const episode: EpisodeInput = {
        podcast_id: podcastRow.id,
        guid: item.guid ?? item.link ?? crypto.randomUUID(),
        title: item.title ?? "Untitled episode",
        description: item.content ?? item.contentSnippet ?? null,
        audio_url: audioUrl,
        audio_length: item.enclosure?.length ? Number(item.enclosure.length) : null,
        duration_sec: parseDuration(item.itunes?.duration),
        published_at: parseDate(item.pubDate),
        episode_type: episodeType,
      };
      upsertEpisode(episode);
    }
  })();

  return podcastFromRow(podcastRow);
}

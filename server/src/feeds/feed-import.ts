import Parser from "rss-parser";
import type { Podcast } from "@podsub/schemas";
import type { EpisodeInput, PodcastInput } from "../db/queries.js";
import { readBodyCapped, safeFetch } from "../lib/safe-fetch.js";

type FeedExtras = { language?: string; "podcast:guid"?: string; "podcast:license"?: string };
type ItemExtras = { itunes?: { duration?: string }; "itunes:type"?: string };
const parser = new Parser<FeedExtras, ItemExtras>({
  customFields: {
    feed: ["podcast:guid", "podcast:license"],
    item: ["itunes:type"],
  },
});

type SavedFeed = { podcast: Podcast; etag: string | null; lastModified: string | null };
export type FeedImport = {
  podcast: PodcastInput;
  episodes: Omit<EpisodeInput, "podcast_id">[];
  etag: string | null;
  lastModified: string | null;
};

function parseDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = value.split(":").map(Number);
  return parts.some((part) => Number.isNaN(part))
    ? null
    : parts.reduce((duration, part) => duration * 60 + part, 0);
}

function parseDate(value: string | undefined): number | null {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function customField(obj: unknown, key: string): string | null {
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/** HTTP/parsing lifecycle, independent of database ownership and transactions. */
export function createFeedImporter({
  getSaved,
  save,
  fetchFeed = safeFetch,
}: {
  getSaved: (url: string) => SavedFeed | undefined;
  save: (feed: FeedImport) => Podcast;
  fetchFeed?: typeof safeFetch;
}) {
  const pending = new Map<string, Promise<Podcast>>();

  async function load(url: string): Promise<Podcast> {
    const saved = getSaved(url);
    const headers: Record<string, string> = {
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    };
    if (saved?.etag) headers["If-None-Match"] = saved.etag;
    if (saved?.lastModified) headers["If-Modified-Since"] = saved.lastModified;
    const res = await fetchFeed(url, { headers });
    if (res.status === 304 && saved) return saved.podcast;
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`Feed request failed with status ${res.status}`);
    }
    const xml = (await readBodyCapped(res, 10 * 1024 * 1024)).toString("utf8");
    const feed = await parser.parseString(xml);
    const episodes: FeedImport["episodes"] = [];
    for (const item of feed.items) {
      const audioUrl = item.enclosure?.url;
      if (!audioUrl) continue;
      const declaredType = customField(item, "itunes:type");
      episodes.push({
        // A stable enclosure fallback avoids duplicate rows on every refresh.
        guid: item.guid ?? item.link ?? audioUrl,
        title: item.title ?? "Untitled episode",
        description: item.content ?? item.contentSnippet ?? null,
        audio_url: audioUrl,
        audio_length: item.enclosure?.length ? Number(item.enclosure.length) : null,
        duration_sec: parseDuration(item.itunes?.duration),
        published_at: parseDate(item.pubDate),
        episode_type:
          declaredType === "trailer" || declaredType === "bonus" ? declaredType : "full",
      });
    }
    return save({
      podcast: {
        feed_url: url,
        guid: customField(feed, "podcast:guid"),
        title: feed.title ?? "Untitled",
        description: feed.description ?? null,
        language: feed.language ?? null,
        author: feed.itunes?.author ?? null,
        image_url: feed.itunes?.image ?? feed.image?.url ?? null,
        license_url: customField(feed, "podcast:license"),
      },
      episodes,
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
    });
  }

  return (url: string): Promise<Podcast> => {
    const existing = pending.get(url);
    if (existing) return existing;
    const request = load(url).finally(() => pending.delete(url));
    pending.set(url, request);
    return request;
  };
}

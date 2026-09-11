import {
  FEED_REFRESH_INTERVAL_MS,
  FEED_REFRESH_STARTUP_DELAY_MS,
} from "../config.js";
import { listPodcastFeeds } from "../db/queries.js";
import { importFeed } from "./importer.js";

// Overlap guard: a slow run (many feeds / slow upstreams) must not stack
// with the next tick. better-sqlite3 is synchronous, so one flag suffices.
let refreshing = false;

export function isRefreshing(): boolean {
  return refreshing;
}

export type FeedRefreshSummary = { ok: number; failed: number; total: number };

/**
 * Re-fetch every subscribed feed; one bad feed never aborts the rest.
 * Returns null when another run is already in progress (caller should
 * answer 409 instead of starting a second run).
 */
export async function refreshAllFeeds(reason: string): Promise<FeedRefreshSummary | null> {
  if (refreshing) {
    console.log(`Feed refresh (${reason}): skipped, previous run still going`);
    return null;
  }
  refreshing = true;
  try {
    const feeds = listPodcastFeeds();
    if (feeds.length === 0) return { ok: 0, failed: 0, total: 0 };

    let ok = 0;
    let failed = 0;
    // Sequential: avoids hammering upstreams and keeps SQLite contention nil.
    for (const feed of feeds) {
      try {
        await importFeed(feed.feed_url);
        ok++;
      } catch (err) {
        failed++;
        console.error(`Feed refresh failed for "${feed.title}" (${feed.feed_url}):`, err);
      }
    }
    console.log(`Feed refresh (${reason}): ${ok} ok, ${failed} failed of ${feeds.length}`);
    return { ok, failed, total: feeds.length };
  } finally {
    refreshing = false;
  }
}

/**
 * Tick on FEED_REFRESH_INTERVAL_MS plus one delayed run after boot.
 * Timers are unref()d so they never hold the process open — same pattern
 * as the audio-cache sweep in index.ts.
 */
export function startFeedRefresher(): void {
  const timer = setInterval(() => void refreshAllFeeds("scheduled"), FEED_REFRESH_INTERVAL_MS);
  timer.unref();
  const startup = setTimeout(
    () => void refreshAllFeeds("startup"),
    FEED_REFRESH_STARTUP_DELAY_MS,
  );
  startup.unref();
}

import { db } from "../db/index.js";
import {
  getPodcastByFeedUrl,
  podcastFromRow,
  saveFeedValidators,
  upsertEpisode,
  upsertPodcast,
} from "../db/queries.js";
import { createFeedImporter, type FeedImport } from "./feed-import.js";

// Metadata, episodes and validators commit together. A parse/write failure must
// never leave validators that would skip an import that did not finish.
const saveFeed = db.transaction((feed: FeedImport) => {
  const podcast = upsertPodcast(feed.podcast);
  for (const episode of feed.episodes) upsertEpisode({ ...episode, podcast_id: podcast.id });
  saveFeedValidators(podcast.id, feed.etag, feed.lastModified);
  return podcastFromRow(podcast);
});

export const importFeed = createFeedImporter({
  getSaved(url) {
    const row = getPodcastByFeedUrl(url);
    return row
      ? { podcast: podcastFromRow(row), etag: row.etag, lastModified: row.last_modified }
      : undefined;
  },
  save: saveFeed,
});

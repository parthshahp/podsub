-- Validators belong to a successfully imported feed, not to an attempted fetch.
CREATE TABLE podcast_feed_state (
  podcast_id    TEXT PRIMARY KEY REFERENCES podcast(id) ON DELETE CASCADE,
  etag          TEXT,
  last_modified TEXT
) STRICT;

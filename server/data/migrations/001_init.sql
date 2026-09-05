-- Podcast (the show itself)
CREATE TABLE podcast (
  id            TEXT PRIMARY KEY,
  feed_url      TEXT NOT NULL UNIQUE,
  guid          TEXT,                    -- from <podcast:guid>
  title         TEXT NOT NULL,
  description   TEXT,
  language      TEXT,
  author        TEXT,
  image_url     TEXT,
  license_url   TEXT,                    -- if the feed declares one
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

-- One row per <item> in a feed
CREATE TABLE podcast_episode (
  id              TEXT PRIMARY KEY,
  podcast_id      TEXT NOT NULL REFERENCES podcast(id) ON DELETE CASCADE,
  guid            TEXT NOT NULL,         -- episode guid from feed
  title           TEXT NOT NULL,
  description     TEXT,
  audio_url       TEXT NOT NULL,
  audio_length    INTEGER,               -- bytes
  duration_sec    INTEGER,
  published_at    INTEGER,               -- unix seconds
  episode_type    TEXT CHECK (episode_type IN ('full', 'trailer', 'bonus')),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (podcast_id, guid)
) STRICT;

CREATE INDEX idx_episode_podcast ON podcast_episode (podcast_id, published_at);

-- One per episode per model per language.
-- segments is JSON: [{start, end, speaker, text}, ...] — for ASR output, one
-- segment per word (speaker null). Display lines are derived at read time.
CREATE TABLE transcript (
  id           TEXT PRIMARY KEY,
  episode_id   TEXT NOT NULL REFERENCES podcast_episode(id) ON DELETE CASCADE,
  model        TEXT NOT NULL,           -- ASR model that produced this; cache key
  language     TEXT,
  source       TEXT NOT NULL DEFAULT 'asr',  -- 'asr' | 'human' | 'feed-provided'
  full_text    TEXT,                    -- words joined with spaces, for search
  segments     TEXT,                    -- JSON, queryable via json_extract()/json_each()
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (episode_id, model, language)
) STRICT;

-- Fix transcript identity + freshness.
--
-- 1. UNIQUE (episode_id, model, language) never fires for language=NULL
--    (SQLite treats NULLs as distinct), so re-transcribing without a detected
--    language inserted a duplicate row instead of updating. Rebuild the table
--    without that constraint and add an expression unique index over
--    COALESCE(language, '') so the absent-language case is genuinely unique.
-- 2. Add updated_at: re-transcription now bumps it, so "latest transcript"
--    can be selected by updated_at instead of an unchanged created_at.

CREATE TABLE transcript_new (
  id           TEXT PRIMARY KEY,
  episode_id   TEXT NOT NULL REFERENCES podcast_episode(id) ON DELETE CASCADE,
  model        TEXT NOT NULL,           -- ASR model that produced this; cache key
  language     TEXT,
  source       TEXT NOT NULL DEFAULT 'asr',  -- 'asr' | 'human' | 'feed-provided'
  full_text    TEXT,                    -- for search
  segments     TEXT,                    -- JSON, queryable via json_extract()/json_each()
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

-- Collapse any duplicate rows the old constraint let in (same episode+model
-- with NULL language), keeping the most recently created one.
DELETE FROM transcript WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY episode_id, model, COALESCE(language, '')
      ORDER BY created_at DESC
    ) AS rn
    FROM transcript
  ) WHERE rn = 1
);

INSERT INTO transcript_new
  SELECT id, episode_id, model, language, source, full_text, segments, created_at, created_at
  FROM transcript;

DROP TABLE transcript;
ALTER TABLE transcript_new RENAME TO transcript;

CREATE UNIQUE INDEX idx_transcript_identity
  ON transcript (episode_id, model, COALESCE(language, ''));

-- Per-episode transcript lookups (EXISTS check, latest-transcript read).
CREATE INDEX idx_transcript_episode ON transcript (episode_id);

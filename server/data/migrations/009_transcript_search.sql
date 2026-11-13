-- Derived search data: one active transcript per episode, without duplicating
-- word timestamps. Everything here can be rebuilt from transcript.segments.
CREATE TABLE transcript_search_state (
  episode_id    TEXT PRIMARY KEY REFERENCES podcast_episode(id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL REFERENCES transcript(id) ON DELETE CASCADE,
  updated_at    INTEGER NOT NULL,
  index_version INTEGER NOT NULL
) STRICT;

CREATE TABLE transcript_passage (
  episode_id     TEXT NOT NULL REFERENCES transcript_search_state(episode_id) ON DELETE CASCADE,
  passage_number INTEGER NOT NULL,
  start_sec      REAL NOT NULL,
  end_sec        REAL NOT NULL,
  first_word     INTEGER NOT NULL,
  last_word      INTEGER NOT NULL,
  text           TEXT NOT NULL,
  PRIMARY KEY (episode_id, passage_number)
) STRICT;

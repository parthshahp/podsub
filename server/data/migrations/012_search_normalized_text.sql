-- Unicode normalization is populated by the versioned startup backfill, not
-- SQLite lower(), which only handles ASCII by default.
ALTER TABLE transcript_passage ADD COLUMN normalized_text TEXT NOT NULL DEFAULT '';
ALTER TABLE transcript_search_state ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 0;

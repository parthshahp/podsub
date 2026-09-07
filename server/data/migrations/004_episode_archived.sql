-- Per-episode archive flag. Archived episodes are hidden from the default
-- episode list view but can be revealed with ?includeArchived=1 and un-archived.
-- Re-imports leave this column untouched so archive state survives feed syncs.
ALTER TABLE podcast_episode
  ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));

-- Keeps the default (active-only) episode list sorted without a temp b-tree.
CREATE INDEX idx_episode_podcast_archived
  ON podcast_episode (podcast_id, archived, published_at DESC, created_at DESC);

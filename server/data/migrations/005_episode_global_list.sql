-- The all-episodes listing (/api/episodes with no podcast filter) sorts by the
-- same keys as the per-podcast list, but idx_episode_podcast_list is prefixed
-- by podcast_id and can't serve the global sort without a temporary b-tree.
CREATE INDEX idx_episode_global_list
  ON podcast_episode (published_at DESC, created_at DESC);

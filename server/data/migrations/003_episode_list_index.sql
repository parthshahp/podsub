-- Episode lists ORDER BY published_at DESC, created_at DESC within a podcast;
-- the old (podcast_id, published_at) index can't satisfy that sort, forcing a
-- temporary b-tree sort per page request.
CREATE INDEX idx_episode_podcast_list
  ON podcast_episode (podcast_id, published_at DESC, created_at DESC);

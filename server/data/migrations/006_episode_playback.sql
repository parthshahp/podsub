-- Resume position for episode playback state.
--
-- Played and archived are the same thing in this app: archiving counts as
-- played, and completing an episode auto-archives. The coupling rule is that
-- archived rows never carry a resume point, so:
--   - unplayed    = archived = 0 AND position_sec < 5
--   - in-progress = archived = 0 AND position_sec >= 5
--   - played      = archived = 1 (position_sec is always 0)
-- Un-archiving therefore always starts from the beginning.
--
-- Feed re-imports must leave this column untouched (same guarantee archived
-- has) so progress survives syncs. Position saves against archived rows are
-- ignored server-side — a throttled save landing just after `ended`
-- auto-archives must not resurrect a position.
ALTER TABLE podcast_episode
  ADD COLUMN position_sec REAL NOT NULL DEFAULT 0 CHECK (position_sec >= 0);

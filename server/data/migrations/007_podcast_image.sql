-- Keep one original artwork image per podcast, shared by thumbnails and Anki.
-- A changed feed image URL is a cache miss; the next successful fetch replaces it.
CREATE TABLE podcast_image (
  podcast_id   TEXT PRIMARY KEY REFERENCES podcast(id) ON DELETE CASCADE,
  image_url    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  data         BLOB NOT NULL
) STRICT;

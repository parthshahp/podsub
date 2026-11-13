-- Existing originals are optimized locally on their next use, not re-downloaded.
ALTER TABLE podcast_image ADD COLUMN encoding_version INTEGER NOT NULL DEFAULT 0;

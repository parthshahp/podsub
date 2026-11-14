-- Timestamps have second precision. A monotonic revision also catches rewrites
-- in the same second, including writes from another process.
ALTER TABLE transcript ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE TRIGGER transcript_revision AFTER UPDATE ON transcript
WHEN NEW.revision = OLD.revision
BEGIN
  UPDATE transcript SET revision = OLD.revision + 1 WHERE id = NEW.id;
END;

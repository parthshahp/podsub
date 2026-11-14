import type Database from "better-sqlite3";
import type { Transcript, Word } from "@podsub/schemas";
import { groupWordsIntoLines } from "../lib/transcript-text.js";
import { segmentLines } from "../transcription/segment.js";

type Version = {
  id: string;
  revision: number;
  updated_at: number;
  model: string;
  language: string | null;
};
type Entry = { id: string; revision: number; transcript: Transcript };

/** A bounded LRU of complete derived transcripts, validated by lightweight reads. */
export function createTranscriptReader(
  database: Database.Database,
  { maxEntries = 20, segment = segmentLines } = {},
) {
  const cache = new Map<string, Entry>();
  const version = database.prepare(`
    SELECT id, revision, updated_at, model, language FROM transcript
    WHERE episode_id = ? AND segments IS NOT NULL
    ORDER BY updated_at DESC, rowid DESC LIMIT 1
  `);
  const source = database.prepare("SELECT segments FROM transcript WHERE id = ?");
  // The metadata and cold-cache source must come from the same read snapshot.
  const read = database.transaction(
    (episodeId: string, cacheable: boolean): Transcript | undefined => {
      const current = version.get(episodeId) as Version | undefined;
      if (!current) {
        cache.delete(episodeId);
        return undefined;
      }
      const hit = cacheable ? cache.get(episodeId) : undefined;
      if (hit?.id === current.id && hit.revision === current.revision) {
        cache.delete(episodeId);
        cache.set(episodeId, hit);
        return hit.transcript;
      }
      const { segments } = source.get(current.id) as { segments: string };
      const words: Word[] = (
        JSON.parse(segments) as { text: string; start: number; end: number }[]
      ).map(({ text, start, end }) => ({ word: text, start, end }));
      const transcript: Transcript = {
        model: current.model,
        words,
        lines: segment(groupWordsIntoLines(words), current.language),
        updatedAt: new Date(current.updated_at * 1000).toISOString(),
      };
      if (cacheable) cache.delete(episodeId);
      if (cacheable && maxEntries > 0) {
        if (cache.size >= maxEntries) cache.delete(cache.keys().next().value!);
        cache.set(episodeId, { id: current.id, revision: current.revision, transcript });
      }
      return transcript;
    },
  );
  return {
    get(episodeId: string) {
      // Never publish uncommitted data from a caller-owned write transaction.
      return read(episodeId, !database.inTransaction);
    },
  };
}

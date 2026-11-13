import type Database from "better-sqlite3";
import type { SearchTranscriptsQuery, TranscriptSearch, Word } from "@podsub/schemas";
import { appendWordToLine, groupWordsIntoPassages } from "../lib/transcript-text.js";

// Bump when passage boundaries/normalization change to rebuild on next boot.
const INDEX_VERSION = 1;

type SourceRow = { id: string; episode_id: string; updated_at: number; segments: string };
type PassageRow = {
  episode_id: string;
  episode_title: string;
  podcast_id: string;
  podcast_title: string;
  passage_number: number;
  start_sec: number;
  end_sec: number;
  first_word: number;
  last_word: number;
  text: string;
};

function readWords(segments: string): Word[] {
  return (JSON.parse(segments) as { start: number; end: number; text: string }[]).map((word) => ({
    word: word.text,
    start: word.start,
    end: word.end,
  }));
}

/** Same literal, Unicode-lowercase matching as the SQLite candidate scan.
 * Mapping handles lowercase expansions (e.g. İ) without shifting highlights. */
export function findHighlights(text: string, query: string): { start: number; end: number }[] {
  const normalized = text.toLowerCase();
  const needle = query.toLowerCase();
  if (!needle) return [];
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const char of text) {
    for (let i = 0; i < char.toLowerCase().length; i++) {
      starts.push(offset);
      ends.push(offset + char.length);
    }
    offset += char.length;
  }
  const ranges: { start: number; end: number }[] = [];
  let cursor = 0;
  for (;;) {
    const index = normalized.indexOf(needle, cursor);
    if (index === -1) break;
    const start = starts[index]!;
    const end = ends[index + needle.length - 1]!;
    const previous = ranges.at(-1);
    if (previous && start < previous.end) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
    cursor = index + needle.length;
  }
  return ranges;
}

/** Factory keeps tests/rebuilds isolated from the user's library database. */
export function createTranscriptSearch(database: Database.Database) {
  // No duplicated normalized text or token postings yet. This literal passage
  // scan supports even one-character Chinese queries and SQL wildcard symbols.
  database.function("podsub_lower", { deterministic: true }, (value: unknown) =>
    typeof value === "string" ? value.toLowerCase() : "",
  );
  const latest = database.prepare(`
    SELECT id, episode_id, updated_at, segments FROM transcript
    WHERE episode_id = ? AND segments IS NOT NULL
    ORDER BY updated_at DESC, rowid DESC LIMIT 1
  `);
  const deleteState = database.prepare("DELETE FROM transcript_search_state WHERE episode_id = ?");
  const insertState = database.prepare(`
    INSERT INTO transcript_search_state (episode_id, transcript_id, updated_at, index_version)
    VALUES (?, ?, ?, ?)
  `);
  const insertPassage = database.prepare(`
    INSERT INTO transcript_passage
      (episode_id, passage_number, start_sec, end_sec, first_word, last_word, text)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const replaceEpisode = database.transaction((episodeId: string) => {
    const source = latest.get(episodeId) as SourceRow | undefined;
    // Cascades remove old passages; readers see either complete version.
    deleteState.run(episodeId);
    if (!source) return;
    insertState.run(episodeId, source.id, source.updated_at, INDEX_VERSION);
    const passages = groupWordsIntoPassages(readWords(source.segments));
    for (let i = 0; i < passages.length; i++) {
      const passage = passages[i]!;
      insertPassage.run(
        episodeId,
        i,
        passage.start,
        passage.end,
        passage.firstWord,
        passage.lastWord,
        passage.text,
      );
    }
  });

  const staleEpisodes = database.prepare(`
    SELECT t.episode_id FROM transcript t
    LEFT JOIN transcript_search_state s ON s.episode_id = t.episode_id
    WHERE t.id = (
      SELECT active.id FROM transcript active
      WHERE active.episode_id = t.episode_id AND active.segments IS NOT NULL
      ORDER BY active.updated_at DESC, active.rowid DESC LIMIT 1
    ) AND (s.episode_id IS NULL OR s.transcript_id != t.id
      OR s.updated_at != t.updated_at OR s.index_version != ?)
  `);
  function backfill() {
    const rows = staleEpisodes.all(INDEX_VERSION) as { episode_id: string }[];
    // One short transaction per episode, rather than locking the whole corpus.
    for (const row of rows) replaceEpisode(row.episode_id);
    return rows.length;
  }

  const from = `
    FROM transcript_passage s
    JOIN podcast_episode e ON e.id = s.episode_id
    JOIN podcast p ON p.id = e.podcast_id
    WHERE instr(podsub_lower(s.text), podsub_lower(@q)) > 0
      AND (@podcastId IS NULL OR e.podcast_id = @podcastId)
  `;
  const count = database.prepare(`SELECT count(*) AS total ${from}`);
  const list = database.prepare(`
    SELECT s.*, e.title AS episode_title, p.id AS podcast_id, p.title AS podcast_title ${from}
    ORDER BY e.published_at DESC, e.created_at DESC, e.id, s.passage_number
    LIMIT @limit OFFSET @offset
  `);
  const getWords = database.prepare(`
    SELECT t.segments FROM transcript_search_state s
    JOIN transcript t ON t.id = s.transcript_id WHERE s.episode_id = ?
  `);

  // Keep counts, passage text, and source timestamps in one read snapshot,
  // including when a rebuild/transcription is running in another process.
  const search = database.transaction(
    ({ q, podcastId, limit, offset }: SearchTranscriptsQuery): TranscriptSearch => {
      const query = q.trim();
      if (!query) return { results: [], total: 0, limit, offset };
      const params = { q: query, podcastId: podcastId ?? null };
      const { total } = count.get(params) as { total: number };
      const rows = list.all({ ...params, limit, offset }) as PassageRow[];
      const wordsByEpisode = new Map<string, Word[]>();
      const results = rows.map((row) => {
        const highlights = findHighlights(row.text, query);
        let words = wordsByEpisode.get(row.episode_id);
        if (!words) {
          words = readWords((getWords.get(row.episode_id) as { segments: string }).segments);
          wordsByEpisode.set(row.episode_id, words);
        }
        // Resolve just this page's matches against existing timestamps, rather
        // than duplicating every word's timing/offsets in the search table.
        let prefix = "";
        let matchSec = row.start_sec;
        for (let i = row.first_word; i <= row.last_word; i++) {
          const word = words[i]!;
          prefix = appendWordToLine(prefix, word.word);
          if (prefix.length > highlights[0]!.start) {
            matchSec = word.start;
            break;
          }
        }
        return {
          episodeId: row.episode_id,
          episodeTitle: row.episode_title,
          podcastId: row.podcast_id,
          podcastTitle: row.podcast_title,
          passageNumber: row.passage_number,
          startSec: row.start_sec,
          endSec: row.end_sec,
          matchSec,
          text: row.text,
          highlights,
        };
      });
      return { results, total, limit, offset };
    },
  );

  return {
    replaceEpisode,
    backfill,
    search,
    rebuild() {
      database.transaction(() => {
        database.exec("DELETE FROM transcript_search_state");
        backfill();
      })();
    },
  };
}

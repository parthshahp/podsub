import { db } from "./index.js";
import { appendWordToLine, groupWordsIntoLines } from "../transcription/index.js";
import { getSegmentedLines } from "../transcription/segment.js";
import type {
  Episode,
  Podcast,
  PodcastList,
  TranscribeStatus,
  Transcript,
  Word,
} from "@podsub/schemas";

export type PodcastRow = {
  id: string;
  feed_url: string;
  guid: string | null;
  title: string;
  description: string | null;
  language: string | null;
  author: string | null;
  image_url: string | null;
  license_url: string | null;
  created_at: number;
  updated_at: number;
};

// List queries below add `has_transcript` via a correlated EXISTS
// (backed by idx_transcript_episode) — no extra round-trip per row.
export type EpisodeListRow = EpisodeRow & { has_transcript: 0 | 1 };

export type EpisodeRow = {
  id: string;
  podcast_id: string;
  guid: string;
  title: string;
  description: string | null;
  audio_url: string;
  audio_length: number | null;
  duration_sec: number | null;
  published_at: number | null;
  episode_type: string | null;
  archived: 0 | 1;
  created_at: number;
};

// better-sqlite3 refuses to bind undefined; nullable columns go through this.
function n(v: string | number | null | undefined): string | number | null {
  return v ?? null;
}

// Re-importing a feed refreshes metadata in place, preserving id and created_at.
const upsertPodcastStmt = db.prepare(`
  INSERT INTO podcast (id, feed_url, guid, title, description, language, author, image_url, license_url)
  VALUES (@id, @feed_url, @guid, @title, @description, @language, @author, @image_url, @license_url)
  ON CONFLICT(feed_url) DO UPDATE SET
    guid        = excluded.guid,
    title       = excluded.title,
    description = excluded.description,
    language    = excluded.language,
    author      = excluded.author,
    image_url   = excluded.image_url,
    license_url = excluded.license_url,
    updated_at  = unixepoch()
  RETURNING *
`);

const listPodcastsStmt = db.prepare(`
  SELECT id, title, image_url FROM podcast ORDER BY created_at
`);

const getPodcastStmt = db.prepare(`
  SELECT * FROM podcast WHERE id = ?
`);

const listEpisodesStmt = db.prepare(`
  SELECT *, EXISTS (SELECT 1 FROM transcript WHERE episode_id = podcast_episode.id) AS has_transcript
  FROM podcast_episode
  WHERE podcast_id = @podcastId AND archived = 0
  ORDER BY published_at DESC, created_at DESC
  LIMIT @limit OFFSET @offset
`);

const listEpisodesAllStmt = db.prepare(`
  SELECT *, EXISTS (SELECT 1 FROM transcript WHERE episode_id = podcast_episode.id) AS has_transcript
  FROM podcast_episode WHERE podcast_id = @podcastId
  ORDER BY published_at DESC, created_at DESC
  LIMIT @limit OFFSET @offset
`);

const listEpisodesSearchStmt = db.prepare(`
  SELECT *, EXISTS (SELECT 1 FROM transcript WHERE episode_id = podcast_episode.id) AS has_transcript
  FROM podcast_episode
  WHERE podcast_id = @podcastId AND archived = 0 AND title LIKE @like ESCAPE '\\' COLLATE NOCASE
  ORDER BY published_at DESC, created_at DESC
  LIMIT @limit OFFSET @offset
`);

const listEpisodesSearchAllStmt = db.prepare(`
  SELECT *, EXISTS (SELECT 1 FROM transcript WHERE episode_id = podcast_episode.id) AS has_transcript
  FROM podcast_episode
  WHERE podcast_id = @podcastId AND title LIKE @like ESCAPE '\\' COLLATE NOCASE
  ORDER BY published_at DESC, created_at DESC
  LIMIT @limit OFFSET @offset
`);

const countEpisodesStmt = db.prepare(`
  SELECT count(*) AS count FROM podcast_episode WHERE podcast_id = ? AND archived = 0
`);

const countEpisodesAllStmt = db.prepare(`
  SELECT count(*) AS count FROM podcast_episode WHERE podcast_id = ?
`);

const countEpisodesSearchStmt = db.prepare(`
  SELECT count(*) AS count FROM podcast_episode
  WHERE podcast_id = ? AND archived = 0 AND title LIKE ? ESCAPE '\\' COLLATE NOCASE
`);

const countEpisodesSearchAllStmt = db.prepare(`
  SELECT count(*) AS count FROM podcast_episode
  WHERE podcast_id = ? AND title LIKE ? ESCAPE '\\' COLLATE NOCASE
`);

const getEpisodeStmt = db.prepare(`
  SELECT * FROM podcast_episode WHERE id = ?
`);

// Only ASR transcripts have segments; latest by updated_at.
const getTranscriptStmt = db.prepare(`
  SELECT model, language, segments, updated_at FROM transcript
  WHERE episode_id = ? AND segments IS NOT NULL
  ORDER BY updated_at DESC
  LIMIT 1
`);

// Lightweight existence check — no need to parse the full transcript.
const hasTranscriptStmt = db.prepare(`
  SELECT EXISTS (SELECT 1 FROM transcript WHERE episode_id = ?) AS present
`);

const upsertEpisodeStmt = db.prepare(`
  INSERT INTO podcast_episode (id, podcast_id, guid, title, description, audio_url, audio_length, duration_sec, published_at, episode_type)
  VALUES (@id, @podcast_id, @guid, @title, @description, @audio_url, @audio_length, @duration_sec, @published_at, @episode_type)
  ON CONFLICT(podcast_id, guid) DO UPDATE SET
    title        = excluded.title,
    description  = excluded.description,
    audio_url    = excluded.audio_url,
    audio_length = excluded.audio_length,
    duration_sec = excluded.duration_sec,
    published_at = excluded.published_at,
    episode_type = excluded.episode_type
  RETURNING id
`);

export function listPodcasts(): PodcastList[] {
  const rows = listPodcastsStmt.all() as Array<Pick<PodcastRow, "id" | "title" | "image_url">>;
  return rows.map(podcastFromPodcastList);
}

export function getPodcast(id: string): PodcastRow | undefined {
  return getPodcastStmt.get(id) as PodcastRow | undefined;
}

/** Load the most recent transcript, deriving `lines` at read time. */
export function hasTranscript(episodeId: string): boolean {
  const row = hasTranscriptStmt.get(episodeId) as { present: 0 | 1 };
  return row.present === 1;
}

export function getTranscript(episodeId: string): Transcript | undefined {
  const row = getTranscriptStmt.get(episodeId) as
    | {
        model: string;
        language: string | null;
        segments: string;
        updated_at: number;
      }
    | undefined;
  if (!row) return undefined;

  const segments = JSON.parse(row.segments) as Array<{
    start: number;
    end: number;
    text: string;
  }>;
  const words: Word[] = segments.map((s) => ({
    word: s.text,
    start: s.start,
    end: s.end,
  }));

  return {
    model: row.model,
    words,
    lines: getSegmentedLines(episodeId, row.updated_at, groupWordsIntoLines(words), row.language),
    updatedAt: new Date(row.updated_at * 1000).toISOString(),
  };
}

export function getEpisodeWithPodcast(
  id: string,
): { episode: EpisodeRow; podcast: PodcastRow } | undefined {
  const episode = getEpisodeStmt.get(id) as EpisodeRow | undefined;
  if (!episode) return undefined;
  const podcast = getPodcast(episode.podcast_id);
  if (!podcast) return undefined;
  return { episode, podcast };
}

export function listEpisodesForPodcast(
  podcastId: string,
  {
    limit,
    offset,
    q,
    includeArchived,
  }: { limit: number; offset: number; q?: string; includeArchived?: boolean },
): { rows: EpisodeListRow[]; total: number } {
  const needle = q?.trim() ?? "";
  if (needle === "") {
    const stmt = includeArchived ? listEpisodesAllStmt : listEpisodesStmt;
    const counter = includeArchived ? countEpisodesAllStmt : countEpisodesStmt;
    const rows = stmt.all({ podcastId, limit, offset }) as EpisodeListRow[];
    const { count } = counter.get(podcastId) as { count: number };
    return { rows, total: count };
  }
  // Escape LIKE metacharacters for a literal substring match.
  const like = `%${needle.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const stmt = includeArchived ? listEpisodesSearchAllStmt : listEpisodesSearchStmt;
  const counter = includeArchived ? countEpisodesSearchAllStmt : countEpisodesSearchStmt;
  const rows = stmt.all({ podcastId, like, limit, offset }) as EpisodeListRow[];
  const { count } = counter.get(podcastId, like) as { count: number };
  return { rows, total: count };
}

const setEpisodeArchivedStmt = db.prepare(`
  UPDATE podcast_episode SET archived = ? WHERE id = ?
`);

/** Archive (hide) or un-archive an episode. Returns false when not found. */
export function setEpisodeArchived(id: string, archived: boolean): boolean {
  return setEpisodeArchivedStmt.run(archived ? 1 : 0, id).changes > 0;
}
// SQLite treats NULLs as distinct, so the unique index uses COALESCE(language, '')
// to keep re-runs with an undetected language updating in place.
const upsertTranscriptStmt = db.prepare(`
  INSERT INTO transcript (id, episode_id, model, language, source, full_text, segments)
  VALUES (@id, @episode_id, @model, @language, 'asr', @full_text, @segments)
  ON CONFLICT(episode_id, model, COALESCE(language, '')) DO UPDATE SET
    full_text  = excluded.full_text,
    segments   = excluded.segments,
    updated_at = unixepoch()
  RETURNING updated_at
`);

export type PodcastInput = Omit<PodcastRow, "id" | "created_at" | "updated_at">;

export function upsertPodcast(input: PodcastInput): PodcastRow {
  return upsertPodcastStmt.get({
    id: crypto.randomUUID(),
    ...input,
    guid: n(input.guid),
    description: n(input.description),
    language: n(input.language),
    author: n(input.author),
    image_url: n(input.image_url),
    license_url: n(input.license_url),
  }) as PodcastRow;
}

export type EpisodeInput = Omit<EpisodeRow, "id" | "podcast_id" | "created_at" | "archived"> & {
  podcast_id: string;
};

export function upsertEpisode(input: EpisodeInput): void {
  upsertEpisodeStmt.run({
    id: crypto.randomUUID(),
    ...input,
    description: n(input.description),
    audio_length: n(input.audio_length),
    duration_sec: n(input.duration_sec),
    published_at: n(input.published_at),
    episode_type: n(input.episode_type),
  });
}

/** Persists a transcript; returns its updated_at as an ISO string. */
export function saveTranscript(
  episodeId: string,
  model: string,
  language: string | null,
  words: Word[],
): string {
  const segments = JSON.stringify(
    words.map((w) => ({ start: w.start, end: w.end, speaker: null, text: w.word })),
  );
  const row = upsertTranscriptStmt.get({
    id: crypto.randomUUID(),
    episode_id: episodeId,
    model,
    language,
    full_text: words.reduce((text, w) => appendWordToLine(text, w.word), ""),
    segments,
  }) as { updated_at: number };
  return new Date(row.updated_at * 1000).toISOString();
}

export function episodeFromRow(
  row: EpisodeRow & { has_transcript?: number },
  transcribeStatus: TranscribeStatus = "idle",
): Episode {
  return {
    id: row.id,
    guid: row.guid,
    title: row.title,
    description: row.description,
    audioUrl: row.audio_url,
    audioLength: row.audio_length,
    durationSec: row.duration_sec,
    publishedAt: row.published_at == null ? null : new Date(row.published_at * 1000).toISOString(),
    episodeType: row.episode_type as Episode["episodeType"],
    archived: row.archived === 1,
    hasTranscript: (row.has_transcript ?? 0) === 1,
    transcribeStatus,
  };
}

export function podcastFromRow(row: PodcastRow): Podcast {
  return {
    id: row.id,
    feedUrl: row.feed_url,
    guid: row.guid,
    title: row.title,
    description: row.description,
    language: row.language,
    author: row.author,
    imageUrl: row.image_url,
    licenseUrl: row.license_url,
    createdAt: new Date(row.created_at * 1000).toISOString(),
    updatedAt: new Date(row.updated_at * 1000).toISOString(),
  };
}

export function podcastFromPodcastList(
  row: Pick<PodcastRow, "id" | "title" | "image_url">,
): PodcastList {
  return {
    id: row.id,
    title: row.title,
    imageUrl: row.image_url,
  };
}

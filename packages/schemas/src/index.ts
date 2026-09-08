import { z } from "zod";

export const WordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});

/** Display token from server-side jieba segmentation. `start` is a UTF-16
 * char offset within the line text, matching Intl.Segmenter indices. */
export const LineTokenSchema = z.object({
  text: z.string(),
  start: z.number().int().min(0),
  wordLike: z.boolean(),
});

/** Transcript API response. `lines` is derived server-side, never persisted. */
export const TranscriptSchema = z.object({
  model: z.string(),
  /** Last time this transcript was (re)written. */
  updatedAt: z.iso.datetime(),
  words: z.array(WordSchema),
  lines: z.array(
    z.object({
      start: z.number(),
      text: z.string(),
      /** Jieba display tokens; absent → the client falls back to Intl.Segmenter. */
      tokens: z.array(LineTokenSchema).optional(),
    }),
  ),
});

/** Domain shape for a podcast (camelCase from the DB row). */
export const PodcastSchema = z.object({
  id: z.string(),
  feedUrl: z.string(),
  guid: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  author: z.string().nullable(),
  imageUrl: z.string().nullable(),
  licenseUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const PodcastListSchema = z.object({
  id: z.string(),
  title: z.string(),
  imageUrl: z.string().nullable(),
});

/** Live transcription queue state, mirrored from the server job registry.
 *  - idle: no job (or job finished — check hasTranscript for the result)
 *  - queued/running: transcript on the way; show the in-progress icon
 *  - failed: last attempt failed; allow retry via the download action. */
export const TranscribeStatusSchema = z.enum(["idle", "queued", "running", "failed"]);

/** Domain shape for an episode (camelCase from the DB row). */
export const EpisodeSchema = z.object({
  id: z.string(),
  guid: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  audioUrl: z.string(),
  audioLength: z.number().nullable(),
  durationSec: z.number().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  episodeType: z.enum(["full", "trailer", "bonus"]).nullable(),
  /** True when the user archived the episode (hidden from the default list). */
  archived: z.boolean(),
  /** True when at least one transcript row exists for the episode. */
  hasTranscript: z.boolean(),
  /** Live queue state from the server job registry (resets on restart). */
  transcribeStatus: TranscribeStatusSchema.default("idle"),
});

/** Query params for paginated episode lists (?limit=50&offset=0&q=…). */
export const ListEpisodesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /** Case-insensitive title filter; empty means no filtering. */
  q: z.string().trim().max(200).optional().default(""),
  /** When true, archived episodes are included; otherwise they are hidden. */
  includeArchived: z.coerce.boolean().optional().default(false),
});

export const EpisodeListSchema = z.object({
  episodes: z.array(EpisodeSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

/** GET /api/podcasts/:id — podcast info plus its first page of episodes. */
export const PodcastDetailSchema = z.object({
  podcast: PodcastSchema,
  episodes: z.array(EpisodeSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

/** Body for PATCH /api/episodes/:id/archive — archive or un-archive. */
export const ArchiveEpisodeInputSchema = z.object({
  archived: z.boolean(),
});

/** GET /api/episodes/:id — episode with parent podcast and transcript state. */
export const EpisodeDetailSchema = z.object({
  podcast: PodcastSchema,
  episode: EpisodeSchema,
  /** Source of truth: the DB transcript. */
  hasTranscript: z.boolean(),
  /** Source of truth: the server's in-memory job registry (resets on restart). */
  transcribeStatus: z.enum(["idle", "queued", "running", "failed"]),
  transcribeError: z.string().nullable(),
});

/** Body for POST /api/podcasts — import a show from its RSS feed URL. */
export const CreatePodcastInputSchema = z.object({
  feedUrl: z.string().trim().pipe(z.url()),
});

/**
 * Actions the same-origin Anki proxy (/api/anki) is allowed to forward.
 * Covers everything the client needs; anything else is rejected so the
 * proxy can't be used to drive arbitrary AnkiConnect behavior.
 */
export const ANKI_ACTIONS = [
  "version",
  "deckNames",
  "modelNames",
  "modelFieldNames",
  "addNotes",
  "sync",
] as const;

/** Body for POST /api/anki — forwarded to AnkiConnect server-side. */
export const AnkiProxyInputSchema = z.object({
  action: z.enum(ANKI_ACTIONS),
  version: z.number().int().min(1).max(100).default(6),
  params: z.record(z.string(), z.unknown()).default({}),
});

export type Word = z.infer<typeof WordSchema>;
export type LineToken = z.infer<typeof LineTokenSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type Podcast = z.infer<typeof PodcastSchema>;
export type PodcastList = z.infer<typeof PodcastListSchema>;
export type Episode = z.infer<typeof EpisodeSchema>;
export type EpisodeDetail = z.infer<typeof EpisodeDetailSchema>;
export type ArchiveEpisodeInput = z.infer<typeof ArchiveEpisodeInputSchema>;
export type ListEpisodesQuery = z.infer<typeof ListEpisodesQuerySchema>;
export type EpisodeList = z.infer<typeof EpisodeListSchema>;
export type PodcastDetail = z.infer<typeof PodcastDetailSchema>;
export type CreatePodcastInput = z.infer<typeof CreatePodcastInputSchema>;
export type AnkiAction = (typeof ANKI_ACTIONS)[number];
export type AnkiProxyInput = z.infer<typeof AnkiProxyInputSchema>;
export type TranscribeStatus = z.infer<typeof TranscribeStatusSchema>;

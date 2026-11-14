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
  createdAt: z.iso.datetime(),
  latestEpisodeAt: z.iso.datetime().nullable(),
});

/** Live transcription queue state, mirrored from the server job registry.
 *  - idle: no job (or job finished — check hasTranscript for the result)
 *  - queued/running: transcript on the way; show the in-progress icon
 *  - failed: last attempt failed; allow retry via the download action. */
export const TranscribeStatusSchema = z.enum(["idle", "queued", "running", "failed"]);

/** Body for POST /api/episodes/:id/transcribe — optional model override.
 *  The server allowlists against its supported models; omit for the default. */
export const TranscribeEpisodeInputSchema = z.object({
  model: z.string().trim().min(1).max(200).optional(),
});

/** Shared allowlist for the settings selector and the paid OpenRouter endpoint. */
export const EXPLANATION_MODEL_OPTIONS = [
  { value: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash (default)" },
  { value: "qwen/qwen3.8-flash", label: "Qwen3.8 Flash" },
  { value: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
] as const;
export const DEFAULT_EXPLANATION_MODEL = EXPLANATION_MODEL_OPTIONS[0].value;
export const ExplanationModelSchema = z.enum(
  EXPLANATION_MODEL_OPTIONS.map((option) => option.value),
);

export const ExplainLineInputSchema = z.object({
  lineIndex: z.number().int().min(0),
  /** Detect a stale transcript rather than explaining a different line. */
  text: z.string().min(1).max(6000),
  model: ExplanationModelSchema.default(DEFAULT_EXPLANATION_MODEL),
});

export const LineExplanationSchema = z
  .object({
    translation: z.string().trim().min(1).max(8000),
    explanation: z.string().trim().max(12000),
    phrases: z
      .array(
        z
          .object({
            phrase: z.string().trim().min(1).max(500),
            meaning: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();

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
  /** True when the user archived the episode (hidden from the default list).
   *  Archiving counts as played and clears any saved resume position. */
  archived: z.boolean(),
  /** Resume point in seconds. Always 0 when archived; <5s reads as unplayed. */
  positionSec: z.number().min(0).default(0),
  /** True when at least one transcript row exists for the episode. */
  hasTranscript: z.boolean(),
  /** Live queue state from the server job registry (resets on restart). */
  transcribeStatus: TranscribeStatusSchema.default("idle"),
});

const PodcastIdsQuerySchema = z
  .string()
  .max(20000)
  .transform((value) => value.split(",").filter(Boolean))
  .pipe(z.array(z.string().min(1).max(200)).max(500))
  .optional();

/** Query params for paginated episode lists (?limit=50&offset=0&q=…). */
export const ListEpisodesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /** Case-insensitive title filter; empty means no filtering. */
  q: z.string().trim().max(200).optional().default(""),
  /** When true, archived episodes are included; otherwise they are hidden. */
  includeArchived: z.coerce.boolean().optional().default(false),
  /** When true, only episodes that already have a transcript are listed. */
  hasTranscriptOnly: z.coerce.boolean().optional().default(false),
  /** When true, only in-progress episodes (saved position >= 5s) are listed. */
  inProgressOnly: z.coerce.boolean().optional().default(false),
  /** Optional podcast scope; omit to list episodes across all podcasts. */
  podcastId: z.string().optional(),
  /** Comma-separated podcast IDs to include or exclude before pagination. */
  includePodcastIds: PodcastIdsQuerySchema,
  excludePodcastIds: PodcastIdsQuerySchema,
});

/** Parent podcast summary joined into episode list rows. */
export const EpisodePodcastSchema = z.object({
  id: z.string(),
  title: z.string(),
  imageUrl: z.string().nullable(),
});

/** List-only metadata; descriptions and audio details are fetched by the player route. */
export const EpisodeListItemSchema = EpisodeSchema.pick({
  id: true,
  title: true,
  durationSec: true,
  publishedAt: true,
  archived: true,
  positionSec: true,
  hasTranscript: true,
  transcribeStatus: true,
}).extend({
  podcast: EpisodePodcastSchema,
});

export const EpisodeListSchema = z.object({
  episodes: z.array(EpisodeListItemSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export const SearchTranscriptsQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  podcastId: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export const TranscriptSearchResultSchema = z.object({
  episodeId: z.string(),
  episodeTitle: z.string(),
  podcastId: z.string(),
  podcastTitle: z.string(),
  passageNumber: z.number().int().min(0),
  startSec: z.number(),
  endSec: z.number(),
  matchSec: z.number(),
  text: z.string(),
  /** UTF-16 offsets in text; render as text/mark elements, never HTML. */
  highlights: z.array(z.object({ start: z.number().int(), end: z.number().int() })),
});

export const TranscriptSearchSchema = z.object({
  results: z.array(TranscriptSearchResultSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

/** GET /api/podcasts/:id — podcast info plus its first page of episodes. */
export const PodcastDetailSchema = z.object({
  podcast: PodcastSchema,
  episodes: z.array(EpisodeListItemSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

/** Body for PATCH /api/episodes/:id/archive — archive or un-archive. */
export const ArchiveEpisodeInputSchema = z
  .object({
    archived: z.boolean(),
    /** Restore the previous resume point when undoing an archive. */
    positionSec: z.number().min(0).max(86400).optional(),
  })
  .refine((input) => !input.archived || input.positionSec === undefined, {
    message: "A resume position can only be restored when unarchiving",
  });

/** Body for PATCH /api/episodes/:id/playback — save resume position and
 *  optionally backfill duration from the <audio> element's metadata. */
export const UpdatePlaybackInputSchema = z.object({
  /** Current playback position; values under 5s are stored as 0 (unplayed). */
  positionSec: z.number().min(0).max(86400).optional(),
  /** Real media duration; stored only when the row lacks one or differs by >2s. */
  durationSec: z.number().positive().max(86400).nullable().optional(),
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
export type EpisodePodcast = z.infer<typeof EpisodePodcastSchema>;
export type EpisodeListItem = z.infer<typeof EpisodeListItemSchema>;
export type EpisodeDetail = z.infer<typeof EpisodeDetailSchema>;
export type ArchiveEpisodeInput = z.infer<typeof ArchiveEpisodeInputSchema>;
export type UpdatePlaybackInput = z.infer<typeof UpdatePlaybackInputSchema>;
export type ListEpisodesQuery = z.infer<typeof ListEpisodesQuerySchema>;
export type EpisodeList = z.infer<typeof EpisodeListSchema>;
export type SearchTranscriptsQuery = z.infer<typeof SearchTranscriptsQuerySchema>;
export type TranscriptSearchResult = z.infer<typeof TranscriptSearchResultSchema>;
export type TranscriptSearch = z.infer<typeof TranscriptSearchSchema>;
export type PodcastDetail = z.infer<typeof PodcastDetailSchema>;
export type CreatePodcastInput = z.infer<typeof CreatePodcastInputSchema>;
export type AnkiAction = (typeof ANKI_ACTIONS)[number];
export type AnkiProxyInput = z.infer<typeof AnkiProxyInputSchema>;
export type TranscribeStatus = z.infer<typeof TranscribeStatusSchema>;
export type TranscribeEpisodeInput = z.infer<typeof TranscribeEpisodeInputSchema>;
export type ExplanationModel = z.infer<typeof ExplanationModelSchema>;
export type LineExplanation = z.infer<typeof LineExplanationSchema>;

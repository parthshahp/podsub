import { Link } from "@tanstack/react-router";

import { ArchiveIcon, PlayIcon, SearchIcon, TranscriptIcon, UnarchiveIcon } from "./icons";
import { formatClock, formatDate, formatDuration } from "../lib/format";
import { kebabCase } from "../lib/kebab";
import { podcastImageSrcSet, podcastImageUrl } from "../lib/podcastImage";
import type { EpisodeListItem } from "../types";

type Props = {
  episodes: EpisodeListItem[];
  /** Total matching the current query in the DB — can exceed episodes.length. */
  total: number;
  /** Current search text (controlled by the parent, which queries the server). */
  query: string;
  onQueryChange: (q: string) => void;
  /** True while a debounced server search is in flight. */
  searching: boolean;
  onPlay: (e: EpisodeListItem) => void;
  /** Archive / un-archive an episode (hidden from the default list). */
  onToggleArchive: (e: EpisodeListItem) => void;
  /** Episode id with an archive request in flight (button disabled). */
  archivePendingId: string | null;
  /** Start a transcription job for an episode without a transcript. */
  onDownloadTranscript: (e: EpisodeListItem) => void;
  /** Episode id with a transcribe request in flight (button disabled). */
  transcriptPendingId: string | null;
  /** Episode ids queued for transcription this session (no transcript yet). */
  transcriptStartedIds: Set<string>;
  /** Whether archived episodes are currently included in the list. */
  showArchived: boolean;
  onShowArchivedChange: (v: boolean) => void;
  /** Render the parent podcast under each title (all-episodes page). */
  showPodcast?: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadError: string | null;
  onLoadMore: () => void;
};

/** Below this, a position reads as unplayed (mirrors the server threshold). */
const UNPLAYED_THRESHOLD_SEC = 5;

function isInProgress(e: EpisodeListItem): boolean {
  return !e.archived && (e.positionSec ?? 0) >= UNPLAYED_THRESHOLD_SEC;
}

/**
 * Resume/Played line under each episode title. Archived always means played
 * (archiving clears the position server-side), so archived rows show a
 * static badge while active rows with a position show remaining + bar.
 */
function EpisodeProgressLine({ e }: { e: EpisodeListItem }) {
  if (e.archived) {
    return <span className="mt-0.5 block text-xs text-base-content/50">Played</span>;
  }
  const pos = e.positionSec ?? 0;
  if (pos < UNPLAYED_THRESHOLD_SEC) return null;
  const dur = e.durationSec ?? null;
  const remaining = dur != null ? Math.max(0, dur - pos) : null;
  const frac = dur != null && dur > 0 ? Math.min(1, Math.max(0, pos / dur)) : null;
  return (
    <span className="mt-0.5 block">
      <span className="text-xs text-primary">
        {remaining != null ? `${formatClock(remaining)} left` : `Resume from ${formatClock(pos)}`}
      </span>
      {frac != null && (
        <span
          aria-hidden="true"
          className="mt-1 block h-1 w-32 overflow-hidden rounded-full bg-base-300"
        >
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${Math.round(frac * 100)}%` }}
          />
        </span>
      )}
    </span>
  );
}

export default function EpisodeList({
  episodes,
  total,
  query,
  onQueryChange,
  searching,
  onPlay,
  onToggleArchive,
  archivePendingId,
  onDownloadTranscript,
  transcriptPendingId,
  transcriptStartedIds,
  showArchived,
  onShowArchivedChange,
  showPodcast = false,
  hasMore,
  loadingMore,
  loadError,
  onLoadMore,
}: Props) {
  const trimmed = query.trim();
  return (
    <>
      <div className="mt-10 flex items-center justify-between gap-3 border-b border-base-300 pb-3 sm:gap-6">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-base-content/40" />
          <input
            type="search"
            placeholder="Search all episodes"
            aria-label="Search all episodes"
            aria-busy={searching}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="w-full bg-transparent pl-8 text-[15px] outline-none placeholder:text-base-content/40"
          />
          {searching && (
            <span
              aria-hidden="true"
              className="loading loading-spinner loading-xs absolute top-1/2 right-2 -translate-y-1/2"
            />
          )}
        </div>
        <span className="shrink-0 text-xs font-medium tracking-wide text-base-content/60 uppercase">
          {trimmed ? (
            <>
              {total} match{total === 1 ? "" : "es"}
            </>
          ) : (
            <>
              {total} {total === 1 ? "episode" : "episodes"}
            </>
          )}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-base-content/70 select-none">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => onShowArchivedChange(e.target.checked)}
            className="checkbox checkbox-sm"
          />
          Show archived episodes
        </label>
      </div>

      <ul className="divide-y divide-base-300">
        {episodes.map((e) => (
          <li
            key={e.id}
            className={`flex flex-wrap items-center gap-x-4 gap-y-1 py-4 sm:flex-nowrap sm:gap-6 ${e.archived ? "opacity-50" : ""}`}
          >
            {showPodcast ? (
              <div className="flex min-w-0 basis-full items-center gap-3 sm:basis-auto sm:flex-1 sm:gap-4">
                <Link
                  to="/$slug/$id"
                  params={{ slug: kebabCase(e.podcast.title), id: e.podcast.id }}
                  className="shrink-0 no-underline"
                  aria-label={e.podcast.title}
                >
                  {e.podcast.imageUrl ? (
                    <img
                      src={podcastImageUrl(e.podcast.id, 96)}
                      srcSet={podcastImageSrcSet(e.podcast.id, 96, 256)}
                      alt=""
                      width={48}
                      height={48}
                      loading="lazy"
                      decoding="async"
                      className="h-12 w-12 rounded-md object-cover"
                    />
                  ) : (
                    <span aria-hidden className="block h-12 w-12 rounded-md bg-base-300" />
                  )}
                </Link>
                <div className="min-w-0">
                  <Link
                    to="/player/$episodeId"
                    params={{ episodeId: e.id }}
                    className="block truncate text-[15px] font-medium no-underline hover:underline"
                  >
                    {e.title}
                  </Link>
                  <Link
                    to="/$slug/$id"
                    params={{ slug: kebabCase(e.podcast.title), id: e.podcast.id }}
                    className="mt-0.5 block truncate text-xs text-base-content/50 no-underline hover:text-primary hover:underline"
                  >
                    {e.podcast.title}
                  </Link>
                  <EpisodeProgressLine e={e} />
                </div>
              </div>
            ) : (
              <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                <Link
                  to="/player/$episodeId"
                  params={{ episodeId: e.id }}
                  className="block truncate text-[15px] font-medium no-underline hover:underline"
                >
                  {e.title}
                </Link>
                <EpisodeProgressLine e={e} />
              </div>
            )}
            <span className="shrink-0 text-sm text-base-content/60 sm:w-28 sm:text-right">
              {e.publishedAt ? formatDate(e.publishedAt) : ""}
            </span>
            <span className="shrink-0 text-sm text-base-content/60 tabular-nums sm:w-16 sm:text-right">
              {e.durationSec != null ? formatDuration(e.durationSec) : ""}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1 sm:contents">
              {e.hasTranscript ? (
                <Link
                  to="/player/$episodeId"
                  params={{ episodeId: e.id }}
                  className="btn btn-ghost btn-circle min-h-11 min-w-11 text-success"
                  aria-label={`View transcript for ${e.title}`}
                  title="Transcript downloaded — view it"
                >
                  <TranscriptIcon className="h-5 w-5" />
                </Link>
              ) : transcriptPendingId === e.id ? (
                <button
                  className="btn btn-ghost btn-circle min-h-11 min-w-11"
                  disabled
                  aria-label={`Starting transcript download for ${e.title}`}
                  title="Starting transcript download…"
                >
                  <span className="loading loading-spinner loading-xs" />
                </button>
              ) : transcriptStartedIds.has(e.id) ||
                e.transcribeStatus === "queued" ||
                e.transcribeStatus === "running" ? (
                <button
                  className="btn btn-ghost btn-circle min-h-11 min-w-11"
                  disabled
                  aria-label={`Transcript download in progress for ${e.title}`}
                  title="Transcript download in progress — check back soon"
                >
                  <TranscriptIcon className="h-5 w-5 opacity-40" />
                </button>
              ) : (
                <button
                  className="btn btn-ghost btn-circle min-h-11 min-w-11"
                  onClick={() => onDownloadTranscript(e)}
                  aria-label={`Download transcript for ${e.title}`}
                  title="Download transcript"
                >
                  <TranscriptIcon className="h-5 w-5 opacity-40" />
                </button>
              )}
              <button
                className="btn btn-ghost btn-circle min-h-11 min-w-11"
                onClick={() => onToggleArchive(e)}
                disabled={archivePendingId === e.id}
                aria-label={e.archived ? `Unarchive ${e.title}` : `Archive ${e.title}`}
                title={e.archived ? "Unarchive episode" : "Archive episode"}
              >
                {e.archived ? (
                  <UnarchiveIcon className="h-5 w-5" />
                ) : (
                  <ArchiveIcon className="h-5 w-5" />
                )}
              </button>
              <button
                className="btn btn-ghost btn-circle min-h-11 min-w-11"
                onClick={() => onPlay(e)}
                aria-label={isInProgress(e) ? `Resume ${e.title}` : `Play ${e.title}`}
                title={isInProgress(e) ? "Resume from where you left off" : undefined}
              >
                <PlayIcon className="h-5 w-5" />
              </button>
            </div>
          </li>
        ))}
        {episodes.length === 0 && (
          <li className="py-6 text-sm text-base-content/60">
            {trimmed ? `No episodes match “${trimmed}”.` : "No episodes."}
          </li>
        )}
      </ul>

      {hasMore && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <button className="btn" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore && <span className="loading loading-spinner loading-sm" />}
            {loadingMore ? "Loading…" : `Load more (${total - episodes.length} more)`}
          </button>
          {loadError && <p className="text-sm text-error">{loadError}</p>}
        </div>
      )}
    </>
  );
}

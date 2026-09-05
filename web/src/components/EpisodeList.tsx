import { Link } from "@tanstack/react-router";

import { PlayIcon, SearchIcon } from "./icons";
import { formatDate, formatDuration } from "../lib/format";
import type { Episode } from "../types";

type Props = {
  episodes: Episode[];
  /** Total matching the current query in the DB — can exceed episodes.length. */
  total: number;
  /** Current search text (controlled by the parent, which queries the server). */
  query: string;
  onQueryChange: (q: string) => void;
  /** True while a debounced server search is in flight. */
  searching: boolean;
  onPlay: (e: Episode) => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadError: string | null;
  onLoadMore: () => void;
};

export default function EpisodeList({
  episodes,
  total,
  query,
  onQueryChange,
  searching,
  onPlay,
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

      <ul className="divide-y divide-base-300">
        {episodes.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-4 sm:flex-nowrap sm:gap-6">
            <Link
              to="/player/$episodeId"
              params={{ episodeId: e.id }}
              className="min-w-0 basis-full truncate text-[15px] font-medium no-underline hover:underline sm:basis-auto sm:flex-1"
            >
              {e.title}
            </Link>
            <span className="shrink-0 text-sm text-base-content/60 sm:w-28 sm:text-right">
              {e.publishedAt ? formatDate(e.publishedAt) : ""}
            </span>
            <span className="shrink-0 text-sm text-base-content/60 tabular-nums sm:w-16 sm:text-right">
              {e.durationSec != null ? formatDuration(e.durationSec) : ""}
            </span>
            <button
              className="btn btn-ghost btn-circle ml-auto min-h-11 min-w-11 sm:ml-0"
              onClick={() => onPlay(e)}
              aria-label={`Play ${e.title}`}
            >
              <PlayIcon className="h-5 w-5" />
            </button>
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

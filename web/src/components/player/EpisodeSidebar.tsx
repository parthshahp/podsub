import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";

import { formatDate, formatDuration } from "../../lib/format";
import { stripHtml } from "../../lib/html";
import type { Episode, Podcast } from "../../types";

type EpisodeSidebarProps = {
  podcast: Podcast;
  episode: Episode;
  slug: string;
};

/**
 * Episode metadata: a compact horizontal header below `md` (thumbnail +
 * titles + expandable description) and the full sidebar on `md` and up.
 */
export function EpisodeSidebar({ podcast, episode, slug }: EpisodeSidebarProps) {
  const meta = [
    episode.publishedAt ? formatDate(episode.publishedAt) : "",
    episode.durationSec != null ? formatDuration(episode.durationSec) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const description = episode.description ? stripHtml(episode.description) : "";
  const detailsRef = useRef<HTMLDetailsElement>(null);

  // Native <details> only closes via its <summary> — dismiss on outside
  // tap and Esc so the overlay panel doesn't trap mobile users.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const details = detailsRef.current;
      if (details?.open && !details.contains(e.target as Node))
        details.open = false;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const details = detailsRef.current;
      if (details?.open) details.open = false;
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <>
      {/* Compact header for narrow screens. Uses <header> + <h1> so mobile
          keeps the same heading structure as the desktop sidebar. */}
      <header className="relative flex shrink-0 items-center gap-3 border-b border-base-300 px-3 py-2 md:hidden">
        <Link
          to="/$slug/$id"
          params={{ slug, id: podcast.id }}
          className="block h-12 w-12 shrink-0 overflow-hidden rounded-md"
          aria-label={`Back to ${podcast.title} episodes`}
        >
          {podcast.imageUrl ? (
            <img
              src={podcast.imageUrl}
              alt=""
              width={48}
              height={48}
              loading="eager"
              fetchPriority="high"
              className="aspect-square h-12 w-12 object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex aspect-square h-12 w-12 items-center justify-center bg-base-300 text-center text-[10px] text-base-content/60"
            >
              {podcast.title.slice(0, 2)}
            </span>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <h1 id="episode-title-compact" className="truncate text-sm font-medium">
            {episode.title}
          </h1>
          <p className="truncate text-xs text-base-content/60">{podcast.title}</p>
        </div>
        {(meta || description) && (
          <details ref={detailsRef} className="shrink-0 text-xs">
            <summary className="btn btn-ghost btn-sm min-h-11 rounded-full px-3">
              Details
            </summary>
            <div className="absolute inset-x-3 top-full z-20 rounded-lg border border-base-300 bg-base-100 p-4 shadow-lg">
              {meta && (
                <p className="text-xs text-base-content/60 tabular-nums">{meta}</p>
              )}
              {description && (
                <p className="mt-2 max-h-48 overflow-y-auto text-sm leading-relaxed text-base-content/70">
                  {description}
                </p>
              )}
            </div>
          </details>
        )}
      </header>

      {/* Full sidebar on desktop. */}
      <aside aria-labelledby="episode-title-full" className="hidden w-1/5 min-w-0 flex-col gap-4 overflow-y-auto border-r border-base-300 p-6 md:flex">
        <Link
          to="/$slug/$id"
          params={{ slug, id: podcast.id }}
          className="block shrink-0 overflow-hidden rounded-lg"
          aria-label={`Back to ${podcast.title} episodes`}
        >
          {podcast.imageUrl ? (
            <img
              src={podcast.imageUrl}
              alt={podcast.title}
              width={400}
              height={400}
              loading="eager"
              fetchPriority="high"
              className="aspect-square w-full object-cover"
            />
          ) : (
            <span className="flex aspect-square w-full items-center justify-center bg-base-300 p-4 text-center text-sm text-base-content/60">
              {podcast.title}
            </span>
          )}
        </Link>
        <div className="min-w-0">
          <h1 id="episode-title-full" className="text-sm font-medium">
            {episode.title}
          </h1>
          <p className="text-xs text-base-content/60">{podcast.title}</p>
        </div>
        {meta && (
          <div className="text-xs text-base-content/60 tabular-nums">{meta}</div>
        )}
        {description && (
          <p className="text-sm leading-relaxed text-base-content/70">{description}</p>
        )}
      </aside>
    </>
  );
}

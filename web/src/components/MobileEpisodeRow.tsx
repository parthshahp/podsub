import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { EpisodeListItem } from "../types";
import { formatClock, formatDate, formatDuration } from "../lib/format";
import { kebabCase } from "../lib/kebab";
import { podcastImageUrl } from "../lib/podcastImage";
import { ArchiveIcon, PlayIcon, TranscriptIcon, UnarchiveIcon } from "./icons";
import "./MobileEpisodeRow.css";

type Props = {
  episode: EpisodeListItem;
  showPodcast: boolean;
  onPlay: () => void;
  onArchive: () => void;
  onTranscript: () => void;
  archiving: boolean;
  startingTranscript: boolean;
  transcriptStarted: boolean;
};

/** Phone rows expose one primary action; secondary tools live in a disclosure. */
export default function MobileEpisodeRow({
  episode: e,
  showPodcast,
  onPlay,
  onArchive,
  onTranscript,
  archiving,
  startingTranscript,
  transcriptStarted,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const resume = !e.archived && (e.positionSec ?? 0) >= 5;
  const busy =
    startingTranscript ||
    transcriptStarted ||
    e.transcribeStatus === "queued" ||
    e.transcribeStatus === "running";
  const status = startingTranscript
    ? "Starting transcript…"
    : busy
      ? "Transcribing…"
      : e.transcribeStatus === "failed"
        ? "Transcript failed"
        : null;
  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("a, button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div className="mobile-episode-row relative w-full space-y-3 sm:hidden">
      <div className="flex items-start gap-3">
        {showPodcast && (
          <Link
            to="/$slug/$id"
            params={{ slug: kebabCase(e.podcast.title), id: e.podcast.id }}
            aria-label={e.podcast.title}
            className="shrink-0"
          >
            {e.podcast.imageUrl ? (
              <img
                src={podcastImageUrl(e.podcast.id, 96)}
                alt=""
                width={48}
                height={48}
                loading="lazy"
                className="h-12 w-12 rounded-lg object-cover"
              />
            ) : (
              <span aria-hidden="true" className="block h-12 w-12 rounded-lg bg-base-300" />
            )}
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <Link
            to="/player/$episodeId"
            params={{ episodeId: e.id }}
            className="line-clamp-2 text-base leading-snug font-medium"
          >
            {e.title}
          </Link>
          {showPodcast && (
            <Link
              to="/$slug/$id"
              params={{ slug: kebabCase(e.podcast.title), id: e.podcast.id }}
              className="mt-1 block truncate text-xs text-base-content/60"
            >
              {e.podcast.title}
            </Link>
          )}
          <p className="mt-1 text-xs text-base-content/60">
            {[
              e.publishedAt ? formatDate(e.publishedAt) : "",
              e.durationSec != null ? formatDuration(e.durationSec) : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {e.archived ? (
            <p className="mt-1 text-xs text-base-content/60">Played</p>
          ) : (
            resume && (
              <p className="mt-1 text-xs text-primary">
                {e.durationSec != null
                  ? `${formatClock(Math.max(0, e.durationSec - (e.positionSec ?? 0)))} left`
                  : `Resume from ${formatClock(e.positionSec ?? 0)}`}
              </p>
            )
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-xs text-base-content/60">
          {e.hasTranscript ? (
            <span
              role="img"
              aria-label="Transcript available"
              title="Transcript available"
              className="inline-flex items-center text-success"
            >
              <TranscriptIcon className="h-5 w-5" />
            </span>
          ) : (
            status
          )}
        </span>
        <div
          ref={rootRef}
          className="contents"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <button
            ref={triggerRef}
            type="button"
            aria-label={`More actions for ${e.title}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? `episode-actions-${e.id}` : undefined}
            className="btn btn-ghost btn-circle min-h-11 min-w-11"
            onClick={() => setOpen(!open)}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </button>
          {open && (
            <div
              ref={panelRef}
              id={`episode-actions-${e.id}`}
              role="dialog"
              aria-label="Episode actions"
              className="absolute right-0 bottom-12 z-40 mb-2 w-60 max-w-[calc(100vw-3rem)] rounded-xl border border-base-300 bg-base-100 p-2 shadow-lg"
            >
              {e.hasTranscript ? (
                <Link
                  to="/player/$episodeId"
                  params={{ episodeId: e.id }}
                  className="btn btn-ghost min-h-11 w-full justify-start font-normal"
                  onClick={() => close(false)}
                >
                  <TranscriptIcon className="h-4 w-4" /> View transcript
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    close();
                    onTranscript();
                  }}
                  className="btn btn-ghost min-h-11 w-full justify-start font-normal"
                >
                  <TranscriptIcon className="h-4 w-4" />
                  {busy ? "Transcribing…" : "Download transcript"}
                </button>
              )}
              <button
                type="button"
                disabled={archiving}
                onClick={() => {
                  close();
                  onArchive();
                }}
                className="btn btn-ghost min-h-11 w-full justify-start font-normal"
              >
                {e.archived ? (
                  <UnarchiveIcon className="h-4 w-4" />
                ) : (
                  <ArchiveIcon className="h-4 w-4" />
                )}
                {e.archived ? "Unarchive episode" : "Archive episode"}
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onPlay}
          aria-label={`${resume ? "Resume" : "Play"} ${e.title}`}
          className="btn btn-primary min-h-11 gap-2 rounded-full px-4"
        >
          <PlayIcon className="h-4 w-4" />
          {resume ? "Resume" : "Play"}
        </button>
      </div>
    </div>
  );
}

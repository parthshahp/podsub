import { formatClock } from "../../lib/format";
import type { Episode } from "../../types";
import { PauseIcon, PlayIcon, SkipBack10Icon, SkipForward10Icon, SyncIcon } from "../icons";

type PlayerBarProps = {
  episode: Episode;
  playing: boolean;
  currentTime: number;
  max: number;
  ankiConnected: boolean;
  syncing: boolean;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onSync: () => void;
};

/**
 * Bottom playback bar. Sticky + elevated above the transcript pane so it
 * stays tappable at the viewport bottom on mobile (the transcript wrapper
 * is positioned, so without a z-index it would paint over this bar).
 * Single row on all screens so play + slider + times stay usable one-handed
 * without stealing transcript height; the slider shrinks while the times
 * stay legible. Bottom padding respects the iOS home indicator safe area.
 */
export function PlayerBar({
  episode,
  playing,
  currentTime,
  max,
  ankiConnected,
  syncing,
  onToggle,
  onSeek,
  onSync,
}: PlayerBarProps) {
  const seekBy = (delta: number) => {
    const t = currentTime + delta;
    onSeek(Math.min(Math.max(t, 0), max || t));
  };

  return (
    <footer aria-label="Playback controls" className="sticky bottom-0 z-30 flex shrink-0 items-center gap-x-1 border-t border-base-300 bg-base-100 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-x-3 sm:px-6 sm:py-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <button
        className="btn btn-circle btn-ghost min-h-11 min-w-11"
        onClick={() => seekBy(-10)}
        aria-label="Back 10 seconds"
        title="Back 10 seconds"
      >
        <SkipBack10Icon className="h-6 w-6" />
      </button>
      <button
        className="btn btn-circle btn-ghost min-h-11 min-w-11"
        onClick={onToggle}
        aria-label={playing ? `Pause ${episode.title}` : `Play ${episode.title}`}
        title="Play/pause (Space)"
      >
        {playing ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6" />}
      </button>
      <button
        className="btn btn-circle btn-ghost min-h-11 min-w-11"
        onClick={() => seekBy(10)}
        aria-label="Forward 10 seconds"
        title="Forward 10 seconds"
      >
        <SkipForward10Icon className="h-6 w-6" />
      </button>
      <div className="flex min-w-0 flex-1 basis-48 items-center gap-2 text-xs text-base-content/60 tabular-nums">
        <span className="shrink-0">{formatClock(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={Math.min(currentTime, max)}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="range range-sm pointer-coarse:range-md min-w-0 flex-1"
          aria-label="Seek"
          aria-valuetext={`${formatClock(currentTime)} of ${formatClock(max)}`}
        />
        <span className="shrink-0">{formatClock(max)}</span>
      </div>
      {ankiConnected && (
        <button
          className="btn btn-ghost btn-circle min-h-11 min-w-11"
            disabled={syncing}
            onClick={onSync}
            aria-label="Sync Anki"
            title="Sync Anki"
          >
            {syncing ? (
              <span className="loading loading-spinner loading-xs" aria-hidden="true" />
            ) : (
              <SyncIcon className="h-5 w-5" />
            )}
          </button>
      )}
    </footer>
  );
}

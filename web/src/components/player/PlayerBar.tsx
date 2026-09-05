import { formatClock } from "../../lib/format";
import type { Episode } from "../../types";
import { PauseIcon, PlayIcon, SyncIcon } from "../icons";

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
 * Bottom playback bar. Wraps on narrow screens so play + slider + times
 * stay usable one-handed, with the Anki sync action trailing.
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
  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-base-300 bg-base-100 px-3 py-2 sm:px-6 sm:py-3">
      <button
        className="btn btn-circle btn-ghost min-h-11 min-w-11"
        onClick={onToggle}
        aria-label={playing ? `Pause ${episode.title}` : `Play ${episode.title}`}
        title="Play/pause (Space)"
      >
        {playing ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6" />}
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

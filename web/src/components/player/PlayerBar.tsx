import { memo, useCallback, useSyncExternalStore } from "react";

import { formatClock } from "../../lib/format";
import type { Episode } from "../../types";
import { PauseIcon, PlayIcon, SkipBack10Icon, SkipForward10Icon, SyncIcon } from "../icons";

type PlayerBarProps = {
  episode: Episode;
  playing: boolean;
  max: number;
  ankiConnected: boolean;
  syncing: boolean;
  /** useSyncExternalStore source from usePlayer — the bar is the only
   *  subtree that subscribes to the raw ~4Hz time (small, isolated). */
  subscribeToTime: (cb: () => void) => () => void;
  getTime: () => number;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onSync: () => void;
};

/**
 * Bottom playback bar. Sticky + elevated above the transcript pane so it
 * stays tappable at the viewport bottom on mobile (the transcript wrapper
 * is positioned, so without a z-index it would paint over this bar).
 * On phones the full-width timeline sits above a centered transport row.
 * Desktop keeps the compact single row. The document's safe-area padding
 * protects the home indicator.
 *
 * Memoized + self-subscribed: the page passes stable props and never
 * re-renders during playback; only this bar ticks.
 */
export const PlayerBar = memo(function PlayerBar({
  episode,
  playing,
  max,
  ankiConnected,
  syncing,
  subscribeToTime,
  getTime,
  onToggle,
  onSeek,
  onSync,
}: PlayerBarProps) {
  // The <audio> clock ticks ~4Hz with fractional seconds, but everything
  // here renders whole seconds (labels) and step={1} (slider). Subscribing
  // to the floored snapshot drops this bar from ~4 renders/sec to 1 —
  // useSyncExternalStore only re-renders when the snapshot value changes.
  const getSecond = useCallback(() => Math.floor(getTime()), [getTime]);
  const currentSecond = useSyncExternalStore(subscribeToTime, getSecond);

  const seekBy = (delta: number) => {
    // Precise clock for the math (the quantized render value would
    // silently drop the sub-second fraction on ±10s skips).
    const t = getTime() + delta;
    onSeek(Math.min(Math.max(t, 0), max || t));
  };
  return (
    <footer
      aria-label="Playback controls"
      className="sticky bottom-0 z-30 flex shrink-0 flex-col gap-1 border-t border-base-300 bg-base-100 px-4 pt-1 pb-3 sm:flex-row sm:gap-3 sm:px-6 sm:py-3"
    >
      <div className="flex min-h-11 w-full min-w-0 items-center gap-3 text-xs text-base-content/60 tabular-nums sm:order-4 sm:flex-1">
        <span className="shrink-0">{formatClock(currentSecond)}</span>
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={Math.min(currentSecond, max)}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="range range-sm pointer-coarse:range-md min-w-0 flex-1"
          aria-label="Seek"
          aria-valuetext={`${formatClock(currentSecond)} of ${formatClock(max)}`}
        />
        <span className="shrink-0">{formatClock(max)}</span>
      </div>
      <div className="flex items-center justify-center gap-6 sm:contents">
        <button
          className="btn btn-circle btn-ghost min-h-11 min-w-11 sm:order-1"
          onClick={() => seekBy(-10)}
          aria-label="Back 10 seconds"
          title="Back 10 seconds"
        >
          <SkipBack10Icon className="h-6 w-6" />
        </button>
        <button
          className="btn btn-circle btn-primary h-14 w-14 sm:order-2 sm:h-11 sm:w-11 sm:border-transparent sm:bg-transparent sm:text-base-content sm:shadow-none"
          onClick={onToggle}
          aria-label={playing ? `Pause ${episode.title}` : `Play ${episode.title}`}
          title="Play/pause (Space)"
        >
          {playing ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6" />}
        </button>
        <button
          className="btn btn-circle btn-ghost min-h-11 min-w-11 sm:order-3"
          onClick={() => seekBy(10)}
          aria-label="Forward 10 seconds"
          title="Forward 10 seconds"
        >
          <SkipForward10Icon className="h-6 w-6" />
        </button>
      </div>
      {ankiConnected && (
        <button
          className="btn btn-ghost btn-circle absolute right-3 bottom-4 min-h-11 min-w-11 sm:static sm:order-5"
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
});

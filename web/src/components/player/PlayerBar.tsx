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
 * Single row on all screens so play + slider + times stay usable one-handed
 * without stealing transcript height; the slider shrinks while the times
 * stay legible. Bottom padding respects the iOS home indicator safe area.
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
      className="sticky bottom-0 z-30 flex shrink-0 items-center gap-x-1 border-t border-base-300 bg-base-100 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-x-3 sm:px-6 sm:py-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
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
});

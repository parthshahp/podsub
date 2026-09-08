import { useCallback, useMemo, useRef, useState } from "react";

import { episodeAudioUrl } from "../lib/audioClip";
import type { Episode } from "../types";

/**
 * Shared <audio> element plus playback state.
 * Renders nothing itself — spread `audioElement` into the tree once.
 *
 * Playback position is a subscription, not state: `onTimeUpdate` fires ~4Hz,
 * and holding it in `useState` at the page level would re-render the entire
 * page on every tick. Instead the time lives in a ref; interested subtrees
 * opt in via `useSyncExternalStore(subscribeToTime, getTime)`:
 * - `PlayerBar` subscribes to the raw time (re-renders every tick — small).
 * - the transcript subscribes to the derived `activeIdx` (re-renders only
 *   when the highlighted line actually changes).
 * The page itself never subscribes, so it stays idle during playback.
 */
export function usePlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentUrlRef = useRef<string | null>(null);
  const [current, setCurrent] = useState<Episode | null>(null);
  const [duration, setDuration] = useState(0);

  // Mutable time store + listener set (the useSyncExternalStore source).
  const timeRef = useRef(0);
  const listenersRef = useRef(new Set<() => void>());

  const subscribeToTime = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  const getTime = useCallback(() => timeRef.current, []);

  const setTime = useCallback((t: number) => {
    timeRef.current = t;
    for (const cb of listenersRef.current) cb();
  }, []);

  // `current` in a ref so togglePlay keeps a stable identity — otherwise
  // every play/pause would invalidate every memoized row downstream.
  const currentRef = useRef(current);
  currentRef.current = current;

  const togglePlay = useCallback(
    (e: Episode) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (currentRef.current?.id === e.id) {
        audio.pause();
        setCurrent(null);
        return;
      }
      // One same-origin URL serves both playback and export clips.
      if (currentUrlRef.current !== e.audioUrl) {
        const url = episodeAudioUrl(e.id);
        // Compare raw strings: audio.src is the absolute resolved URL.
        audio.src = url;
        currentUrlRef.current = e.audioUrl;
        setTime(0);
        setDuration(e.durationSec ?? 0);
      }
      setCurrent(e);
      audio.play().catch(() => setCurrent(null));
    },
    [setTime],
  );

  // Stable identity so memoized transcript rows don't re-render each tick.
  const seek = useCallback(
    (t: number) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(t)) return;
      audio.currentTime = t;
      setTime(t);
    },
    [setTime],
  );

  const handleTimeUpdate = useCallback(
    (e: React.SyntheticEvent<HTMLAudioElement>) => {
      setTime(e.currentTarget.currentTime);
    },
    [setTime],
  );

  const handleLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLAudioElement>) => {
    setDuration(e.currentTarget.duration || 0);
  }, []);

  const handleEnded = useCallback(() => {
    setCurrent(null);
    setTime(0);
  }, [setTime]);

  // Stable element: handlers above never change, so React never even
  // re-differs the <audio> props on playback ticks.
  const audioElement = useMemo(
    () => (
      <audio
        ref={audioRef}
        preload="none"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />
    ),
    [handleTimeUpdate, handleLoadedMetadata, handleEnded],
  );

  return {
    audioElement,
    current,
    playingId: current?.id ?? null,
    duration,
    togglePlay,
    seek,
    subscribeToTime,
    getTime,
  };
}

/** Type of the object returned by usePlayer, for prop drilling. */
export type Player = ReturnType<typeof usePlayer>;

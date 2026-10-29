import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { episodeAudioUrl } from "../lib/audioClip";
import { isPlaybackRate, loadPlaybackRate, savePlaybackRate } from "../lib/playbackSettings";
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
  const [playbackRate, setPlaybackRate] = useState(loadPlaybackRate);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const selectedRef = useRef<Episode | null>(null);
  const playRequestRef = useRef(0);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.defaultPlaybackRate = playbackRate;
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const changePlaybackRate = useCallback((rate: number) => {
    if (!isPlaybackRate(rate)) return;
    setPlaybackRate(rate);
    savePlaybackRate(rate);
  }, []);

  useEffect(
    () => () => {
      playRequestRef.current++;
    },
    [],
  );
  // Resume offset for a freshly loaded source. <audio> ignores currentTime
  // before metadata arrives, so this is applied in onLoadedMetadata.
  const pendingStartRef = useRef<number | null>(null);

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

  const playEpisode = useCallback(
    (e: Episode, retry = false) => {
      const audio = audioRef.current;
      if (!audio) return;
      const request = ++playRequestRef.current;
      selectedRef.current = e;
      setPlaybackError(null);
      // Include the episode id: two episodes can share an enclosure URL.
      const source = `${e.id}:${e.audioUrl}`;
      if (currentUrlRef.current !== source || retry) {
        const sameSource = currentUrlRef.current === source;
        const startAt = sameSource ? getTime() : e.archived ? 0 : Math.max(0, e.positionSec ?? 0);
        pendingStartRef.current = startAt > 0 ? startAt : null;
        audio.src = episodeAudioUrl(e.id);
        currentUrlRef.current = source;
        setTime(startAt);
        if (!sameSource) setDuration(e.durationSec ?? 0);
        if (retry) audio.load();
      }
      currentRef.current = e;
      setCurrent(e);
      void audio.play().catch((err: unknown) => {
        // Source switches and pauses can reject an older play() promise.
        if (request !== playRequestRef.current) return;
        currentRef.current = null;
        setCurrent(null);
        const blocked = err instanceof DOMException && err.name === "NotAllowedError";
        setPlaybackError(
          blocked
            ? "Playback was blocked by your browser. Select Retry audio to start listening."
            : "Audio could not be played. Check your connection and retry.",
        );
      });
    },
    [getTime, setTime],
  );

  const togglePlay = useCallback(
    (e: Episode) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (currentRef.current?.id === e.id) {
        playRequestRef.current++;
        audio.pause();
        currentRef.current = null;
        setCurrent(null);
        return;
      }
      playEpisode(e, audio.error != null);
    },
    [playEpisode],
  );

  const retryPlayback = useCallback(() => {
    if (selectedRef.current) playEpisode(selectedRef.current, true);
  }, [playEpisode]);

  const handleError = useCallback(() => {
    const audio = audioRef.current;
    if (!audio?.error || !selectedRef.current) return;
    playRequestRef.current++;
    currentRef.current = null;
    setCurrent(null);
    setPlaybackError(
      audio.error.code === 4
        ? "This audio is unavailable or its format is unsupported. Try loading it again."
        : "Audio could not be loaded. Check your connection and retry.",
    );
  }, []);

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

  // Deliberately not the only `loadedmetadata` listener on this element:
  // usePlaybackProgress attaches its own native listener for the unrelated
  // `durationSec` server backfill (a persistence side effect that must not
  // live in this hook). This one owns the player state — duration plus the
  // deferred resume seek.
  const handleLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget;
    setDuration(audio.duration || 0);
    // Apply the deferred resume offset now that seeking is possible.
    const startAt = pendingStartRef.current;
    pendingStartRef.current = null;
    if (startAt != null && startAt > 0 && Number.isFinite(audio.duration)) {
      // Clamp so a stale position at/past the end restarts cleanly.
      audio.currentTime = Math.min(startAt, Math.max(0, audio.duration - 5));
    }
  }, []);

  const handleEnded = useCallback(() => {
    playRequestRef.current++;
    currentRef.current = null;
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
        onError={handleError}
      />
    ),
    [handleTimeUpdate, handleLoadedMetadata, handleEnded, handleError],
  );

  return {
    audioElement,
    audioRef,
    current,
    duration,
    playbackRate,
    changePlaybackRate,
    playbackError,
    retryPlayback,
    togglePlay,
    seek,
    subscribeToTime,
    getTime,
  };
}

/** Type of the object returned by usePlayer, for prop drilling. */
export type Player = ReturnType<typeof usePlayer>;

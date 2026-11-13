import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { episodeAudioUrl } from "../lib/audioClip";
import { bindMediaSession } from "../lib/mediaSession";
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
  // Keep the loaded episode while paused so a headset / lock-screen Play
  // event can restore the UI without reloading the source or resume offset.
  const loadedEpisodeRef = useRef<Episode | null>(null);
  const [current, setCurrent] = useState<Episode | null>(null);
  const [duration, setDuration] = useState(0);
  // Resume offset for a freshly loaded source. <audio> ignores currentTime
  // before metadata arrives, so this is applied in onLoadedMetadata.
  const pendingStartRef = useRef<{ time: number; resume: boolean } | null>(null);

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

  // Explicit navigation is idempotent: opening a timestamp must never toggle
  // an already-playing episode off or lose to its saved resume position.
  const play = useCallback(
    (e: Episode, startAt?: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const explicitStart = startAt !== undefined && Number.isFinite(startAt);
      const sourceChanged =
        loadedEpisodeRef.current?.id !== e.id || loadedEpisodeRef.current.audioUrl !== e.audioUrl;
      // One same-origin URL serves both playback and export clips.
      if (sourceChanged) {
        const url = episodeAudioUrl(e.id);
        // Compare raw strings: audio.src is the absolute resolved URL.
        audio.src = url;
        setDuration(e.durationSec ?? 0);
      }
      if (sourceChanged || explicitStart) {
        // Archived rows never carry a position (the server pins them to 0).
        const requested = Math.max(
          0,
          explicitStart ? startAt! : e.archived ? 0 : (e.positionSec ?? 0),
        );
        const position =
          !sourceChanged && Number.isFinite(audio.duration)
            ? Math.min(requested, audio.duration)
            : requested;
        pendingStartRef.current = { time: position, resume: !explicitStart };
        setTime(position);
        if (!sourceChanged && audio.readyState >= 1) {
          audio.currentTime = Number.isFinite(audio.duration)
            ? Math.min(position, audio.duration)
            : position;
          pendingStartRef.current = null;
        }
      }
      loadedEpisodeRef.current = e;
      void audio.play().catch(() => {});
    },
    [setTime],
  );

  const togglePlay = useCallback(
    (e: Episode) => {
      const audio = audioRef.current;
      if (audio && loadedEpisodeRef.current?.id === e.id && !audio.paused) audio.pause();
      else play(e);
    },
    [play],
  );

  // Stable identity so memoized transcript rows don't re-render each tick.
  const seek = useCallback(
    (t: number) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(t)) return;
      const position = Math.max(
        0,
        Number.isFinite(audio.duration) ? Math.min(t, audio.duration) : t,
      );
      if (audio.readyState < 1) pendingStartRef.current = { time: position, resume: false };
      else {
        pendingStartRef.current = null;
        audio.currentTime = position;
      }
      setTime(position);
    },
    [setTime],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    return bindMediaSession(audio, seek);
  }, [seek]);

  // System controls and interruptions also emit these events. Deriving
  // state from them keeps the play button, progress saving and wake lock
  // in sync with what the audio is actually doing.
  const handlePlay = useCallback(() => setCurrent(loadedEpisodeRef.current), []);
  const handlePause = useCallback(() => setCurrent(null), []);

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
  const handleLoadedMetadata = useCallback(
    (e: React.SyntheticEvent<HTMLAudioElement>) => {
      const audio = e.currentTarget;
      setDuration(audio.duration || 0);
      // Apply the deferred resume offset now that seeking is possible.
      const startAt = pendingStartRef.current;
      pendingStartRef.current = null;
      if (startAt != null) {
        // Resume avoids a stale position at the end. Explicit search timestamps
        // may legitimately be in the last five seconds (or exactly zero).
        const max = Number.isFinite(audio.duration)
          ? Math.max(0, audio.duration - (startAt.resume ? 5 : 0))
          : startAt.time;
        audio.currentTime = Math.min(startAt.time, max);
        setTime(audio.currentTime);
      }
    },
    [setTime],
  );

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
        onPlay={handlePlay}
        onPause={handlePause}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />
    ),
    [handlePlay, handlePause, handleTimeUpdate, handleLoadedMetadata, handleEnded],
  );

  return {
    audioElement,
    audioRef,
    current,
    duration,
    play,
    togglePlay,
    seek,
    subscribeToTime,
    getTime,
  };
}

/** Type of the object returned by usePlayer, for prop drilling. */
export type Player = ReturnType<typeof usePlayer>;

import { useCallback, useRef, useState } from "react";

import { episodeAudioUrl } from "../lib/audioClip";
import type { Episode } from "../types";

/**
 * Shared <audio> element plus playback state.
 * Renders nothing itself — spread `audioElement` into the tree once.
 */
export function usePlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentUrlRef = useRef<string | null>(null);
  const [current, setCurrent] = useState<Episode | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlay = useCallback(
    (e: Episode) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (current?.id === e.id) {
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
        setCurrentTime(0);
        setDuration(e.durationSec ?? 0);
      }
      setCurrent(e);
      audio.play().catch(() => setCurrent(null));
    },
    [current],
  );

  // Stable identity so memoized transcript rows don't re-render each tick.
  const seek = useCallback((t: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(t)) return;
    audio.currentTime = t;
    setCurrentTime(t);
  }, []);

  const audioElement = (
    <audio
      ref={audioRef}
      preload="none"
      onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
      onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
      onEnded={() => {
        setCurrent(null);
        setCurrentTime(0);
      }}
    />
  );

  return {
    audioElement,
    current,
    playingId: current?.id ?? null,
    currentTime,
    duration,
    togglePlay,
    seek,
  };
}

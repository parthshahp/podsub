import { useEffect, useRef } from "react";

import { api } from "../api";
import type { Episode } from "../types";

/** How often position is persisted while playing. */
const SAVE_INTERVAL_MS = 10_000;
/** Minimum movement since the last save worth persisting. */
const MIN_SAVE_DELTA_SEC = 2;
/** A clock jump bigger than this is a seek — save soon after it lands. */
const SEEK_JUMP_SEC = 2.5;

type Args = {
  episode: Episode;
  /** True while this episode is the active audio source. */
  playing: boolean;
  /** Live duration from usePlayer (audio metadata, falling back to the row). */
  duration: number;
  /** The shared <audio> element owned by usePlayer. */
  audioRef: React.RefObject<HTMLAudioElement | null>;
  /** useSyncExternalStore source from usePlayer (for seek detection). */
  subscribeToTime: (cb: () => void) => () => void;
  getTime: () => number;
};

async function patchPlayback(id: string, body: { positionSec?: number; durationSec?: number }) {
  const res = await api.api.episodes[":id"].playback.$patch({ param: { id }, json: body });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) detail = data.error;
    } catch {
      // Non-JSON error body.
    }
    throw new Error(`Playback save failed (${detail})`);
  }
}

/**
 * Persists the resume position for the open episode (server-only truth).
 *
 * - Periodic save every 10s while playing (movement-gated at 2s).
 * - Immediate save on pause and shortly after seek jumps.
 * - `pagehide` / background-tab save via keepalive fetch.
 * - `ended` archives the episode (= played), which clears the position
 *   server-side; further saves stop from there.
 * - Backfills `durationSec` from <audio> metadata when the row lacks one.
 *
 * Subscribes to nothing that re-renders: all clocks are read via getTime().
 */
export function usePlaybackProgress({
  episode,
  playing,
  duration,
  audioRef,
  subscribeToTime,
  getTime,
}: Args) {
  const savedRef = useRef(episode.positionSec ?? 0);
  // Set once `ended` fires — stops every save path below.
  const completedRef = useRef(false);
  // Latest values for timer/listener callbacks without re-subscribing.
  const liveRef = useRef({ playing, duration });
  liveRef.current = { playing, duration };
  const episodeRef = useRef(episode);
  episodeRef.current = episode;

  // Periodic save while playing.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const ep = episodeRef.current;
      if (completedRef.current || ep.archived || !liveRef.current.playing) return;
      const pos = getTime();
      if (Math.abs(pos - savedRef.current) < MIN_SAVE_DELTA_SEC) return;
      savedRef.current = pos;
      const body: { positionSec: number; durationSec?: number } = { positionSec: pos };
      if (ep.durationSec == null && liveRef.current.duration > 0) {
        body.durationSec = liveRef.current.duration;
      }
      void patchPlayback(ep.id, body).catch((err) => console.error(err));
    }, SAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [episode.id, getTime]);

  // Seek jumps: the time store ticks ~4Hz, so a jump >2.5s between ticks is
  // a seek — persist it a second later (covers scrubbing without waiting
  // for the next periodic tick).
  useEffect(() => {
    let seekTimer: number | null = null;
    let last = getTime();
    const unsub = subscribeToTime(() => {
      const t = getTime();
      const jumped = Math.abs(t - last) > SEEK_JUMP_SEC;
      last = t;
      if (!jumped || seekTimer != null) return;
      seekTimer = window.setTimeout(() => {
        seekTimer = null;
        const ep = episodeRef.current;
        if (completedRef.current || ep.archived) return;
        savedRef.current = t;
        void patchPlayback(ep.id, { positionSec: t }).catch((err) => console.error(err));
      }, 1000);
    });
    return () => {
      unsub();
      if (seekTimer != null) window.clearTimeout(seekTimer);
    };
  }, [subscribeToTime, getTime]);

  // Pause / ended / metadata / unload — attached once per episode.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const id = episode.id;

    const saveClock = (keepalive = false) => {
      const ep = episodeRef.current;
      if (completedRef.current || ep.archived) return;
      const pos = getTime();
      savedRef.current = pos;
      if (keepalive) {
        // Fire-and-forget: the page may be gone before a promise settles.
        void fetch(`/api/episodes/${id}/playback`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positionSec: pos }),
          keepalive: true,
        });
      } else {
        void patchPlayback(id, { positionSec: pos }).catch((err) => console.error(err));
      }
    };

    const onPause = () => {
      // `pause` also fires around `ended` — the completed flag wins there.
      if (!completedRef.current) saveClock();
    };
    const onEnded = () => {
      completedRef.current = true;
      // Played == archived; the server clears the resume position.
      void api.api.episodes[":id"].archive
        .$patch({ param: { id }, json: { archived: true } })
        .catch((err) => console.error("Auto-archive on ended failed:", err));
    };
    const onLoadedMetadata = () => {
      const ep = episodeRef.current;
      if (ep.durationSec == null && Number.isFinite(audio.duration) && audio.duration > 0) {
        void patchPlayback(id, { durationSec: audio.duration }).catch((err) => console.error(err));
      }
    };
    const onPageHide = () => saveClock(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") saveClock(true);
    };

    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [audioRef, episode.id, getTime]);
}

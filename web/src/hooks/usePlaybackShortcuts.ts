import { useEffect, useRef } from "react";

import type { TranscriptLineData } from "../lib/transcriptView";
import type { Episode } from "../types";

type UsePlaybackShortcutsArgs = {
  episode: Episode;
  lines: TranscriptLineData[];
  activeIdx: number;
  togglePlay: (e: Episode) => void;
  seek: (t: number) => void;
  setFollow: (v: boolean) => void;
};

/**
 * Keyboard controls: spacebar play/pause, ←/→ to skip a transcript line
 * (repeat allowed). Ignores events from interactive elements.
 */
export function usePlaybackShortcuts({
  episode,
  lines,
  activeIdx,
  togglePlay,
  seek,
  setFollow,
}: UsePlaybackShortcutsArgs) {
  // Latest values for the keydown callback without re-subscribing: the handler
  // must act on whatever is on screen when the key is pressed, so nothing it
  // reads belongs in the deps. `activeIdx` advances roughly once per transcript
  // line while playing, which used to detach/re-attach the window listener on
  // every line; `episode`/`lines` ride along with the render scope, so they are
  // read here instead of being captured. The deps that remain
  // (`togglePlay`/`seek`/`setFollow`) are all stable identities, so the
  // listener below attaches once for the life of the player.
  const liveRef = useRef({ episode, lines, activeIdx });
  liveRef.current = { episode, lines, activeIdx };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const { episode, lines, activeIdx } = liveRef.current;
      const target = e.target as HTMLElement | null;
      if (target?.closest("button, input, select, textarea, a, [contenteditable]")) return;
      if (e.code === "Space") {
        if (e.repeat) return;
        e.preventDefault();
        togglePlay(episode);
      } else if (e.code === "ArrowRight" || e.code === "ArrowLeft") {
        e.preventDefault();
        if (lines.length === 0) return;
        // -1 (nothing active) → lands on line 0.
        const nextIdx =
          e.code === "ArrowRight" ? Math.min(activeIdx + 1, lines.length - 1) : activeIdx - 1;
        const next = lines[nextIdx];
        // Out of range — ← before the first line, or no active line yet: stay put.
        if (!next) return;
        seek(next.start);
        setFollow(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlay, seek, setFollow]);
}

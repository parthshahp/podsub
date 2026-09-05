import { useEffect } from "react";

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
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
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
        if (nextIdx < 0) return;
        seek(lines[nextIdx].start);
        setFollow(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [episode, togglePlay, lines, activeIdx, seek, setFollow]);
}

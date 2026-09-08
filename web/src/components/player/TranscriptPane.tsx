import { memo, type MouseEventHandler, type RefObject } from "react";

import type { TranscriptLineData } from "../../lib/transcriptView";
import { TranscriptLine } from "./TranscriptLine";

type TranscriptPaneProps = {
  lines: TranscriptLineData[];
  activeIdx: number;
  follow: boolean;
  dialogKey: string | null;
  containerRef: RefObject<HTMLOListElement | null>;
  onSeekLine: (start: number) => void;
  /**
   * Delegated word interactions — one listener per event on the <ol>,
   * reading the word button's data attributes. Stable across renders and
   * shared by all ~5k word buttons, instead of per-button closures.
   */
  onWordOver: MouseEventHandler<HTMLOListElement>;
  onWordOut: MouseEventHandler<HTMLOListElement>;
  onWordClick: MouseEventHandler<HTMLOListElement>;
  onUserScroll: () => void;
  onScrollHide: () => void;
  onResumeFollow: () => void;
};

/**
 * Transcript scroll pane: line rows plus the auto-scroll resume button.
 * Renders a fragment — the parent provides the positioned wrapper so the
 * dictionary popover and status toast can overlay this pane.
 *
 * A real <ol> (lines are ordered) so screen readers announce position;
 * the active row carries `aria-current` plus visually-hidden text.
 * Per-tick live announcements are deliberately avoided (too chatty) —
 * screen-reader users navigate rows as a list with full seek/lookup
 * controls on each.
 *
 * Memoized: props change only when the active line, follow flag, or open
 * dialog change — not on playback ticks or hover previews — so the ~4Hz
 * time subscription and word hover never re-map the row list.
 */
export const TranscriptPane = memo(function TranscriptPane({
  lines,
  activeIdx,
  follow,
  dialogKey,
  containerRef,
  onSeekLine,
  onWordOver,
  onWordOut,
  onWordClick,
  onUserScroll,
  onScrollHide,
  onResumeFollow,
}: TranscriptPaneProps) {
  return (
    <>
      <ol
        ref={containerRef}
        aria-label="Transcript"
        className="h-full list-none overflow-y-auto p-3 sm:p-6"
        onWheel={onUserScroll}
        onTouchMove={onUserScroll}
        onScroll={onScrollHide}
        onMouseOver={onWordOver}
        onMouseOut={onWordOut}
        onClick={onWordClick}
      >
        {lines.map((line, i) => (
          <TranscriptLine
            key={i}
            line={line}
            index={i}
            isActive={i === activeIdx}
            dialogKey={dialogKey}
            onSeek={onSeekLine}
          />
        ))}
      </ol>
      {!follow && (
        <button
          className="btn absolute bottom-4 left-1/2 min-h-11 -translate-x-1/2 rounded-full shadow-md"
          onClick={onResumeFollow}
        >
          ↓ Auto-scroll
        </button>
      )}
    </>
  );
});

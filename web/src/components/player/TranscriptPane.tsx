import type { RefObject } from "react";

import type { TranscriptLineData } from "../../lib/transcriptView";
import type { WordHoverInfo } from "../WordSpans";
import { TranscriptLine } from "./TranscriptLine";

type TranscriptPaneProps = {
  lines: TranscriptLineData[];
  activeIdx: number;
  follow: boolean;
  dialogKey: string | null;
  containerRef: RefObject<HTMLOListElement | null>;
  onSeekLine: (start: number) => void;
  onWordEnter: (info: WordHoverInfo) => void;
  onWordLeave: () => void;
  onWordActivate: (info: WordHoverInfo) => void;
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
 */
export function TranscriptPane({
  lines,
  activeIdx,
  follow,
  dialogKey,
  containerRef,
  onSeekLine,
  onWordEnter,
  onWordLeave,
  onWordActivate,
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
      >
        {lines.map((line, i) => (
          <TranscriptLine
            key={i}
            line={line}
            index={i}
            isActive={i === activeIdx}
            dialogKey={dialogKey}
            onSeek={onSeekLine}
            onWordEnter={onWordEnter}
            onWordLeave={onWordLeave}
            onWordActivate={onWordActivate}
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
}

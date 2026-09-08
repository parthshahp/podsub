import { memo, useMemo } from "react";

import { isHanText } from "../lib/dictionary";
import { segmentLine, type TextSegment } from "../lib/segmentation";

/** Hovered or activated Han word — everything needed for lookup, placement, and export. */
export type WordHoverInfo = {
  word: string;
  lineText: string;
  /** Char offset of the segment within `lineText` (for lookup backoff). */
  start: number;
  /** Transcript line index (for sentence/audio export). */
  lineIndex: number;
  /** The word button element, for popover positioning and focus return. */
  el: HTMLElement;
};

type WordSpansProps = {
  text: string;
  /**
   * Server-side jieba tokens (same shape as TextSegment). Rendered directly
   * when present; otherwise the line is segmented locally with Intl.Segmenter.
   */
  tokens?: TextSegment[];
  /** Index of the transcript line being rendered. */
  lineIndex: number;
  /** `${lineIndex}:${start}` key of the word whose dialog is open, if any. */
  expandedKey?: string | null;
};

/**
 * Transcript text with Han words segmented into individually activatable
 * word buttons. Hover previews the definition on fine pointers; activating
 * the button opens the dictionary dialog (keyboard, click, and touch).
 *
 * Memoized, and deliberately hook-free with zero per-word callbacks:
 * interaction is handled by three delegated listeners on the parent <ol>
 * (mouseover/mouseout/click), which read the button's data attributes.
 * The previous per-word component ran 2 hooks per word (~9k hook calls for
 * a full transcript) and gave every button fresh closures each render,
 * defeating memoization. Now a line re-renders only when its own
 * text/tokens/expanded state change, and buttons are static host elements.
 */
export const WordSpans = memo(function WordSpans({
  text,
  tokens,
  lineIndex,
  expandedKey,
}: WordSpansProps) {
  const segments = useMemo(() => tokens ?? segmentLine(text), [tokens, text]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.wordLike && isHanText(seg.text) ? (
          <button
            key={i}
            type="button"
            data-word-btn=""
            data-word={seg.text}
            data-start={seg.start}
            data-line-index={lineIndex}
            aria-haspopup="dialog"
            aria-expanded={expandedKey === `${lineIndex}:${seg.start}`}
            aria-controls={
              expandedKey === `${lineIndex}:${seg.start}` ? "dictionary-dialog" : undefined
            }
            className="-my-1 cursor-pointer rounded-sm px-px py-1 hover:bg-primary/15"
          >
            {seg.text}
          </button>
        ) : (
          seg.text
        ),
      )}
    </>
  );
});

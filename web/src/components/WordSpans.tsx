import { useMemo } from "react";

import { isHanText } from "../lib/dictionary";
import { segmentLine } from "../lib/segmentation";

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
  /** Index of the transcript line being rendered. */
  lineIndex: number;
  /** `${lineIndex}:${start}` key of the word whose dialog is open, if any. */
  expandedKey?: string | null;
  onWordEnter?: (info: WordHoverInfo) => void;
  onWordLeave?: () => void;
  /** Click/tap/Enter/Space — opens the dictionary dialog. */
  onWordActivate?: (info: WordHoverInfo) => void;
};

/**
 * Transcript text with Han words segmented into individually activatable
 * word buttons. Hover previews the definition on fine pointers; activating
 * the button opens the dictionary dialog (keyboard, click, and touch).
 */
export function WordSpans({
  text,
  lineIndex,
  expandedKey,
  onWordEnter,
  onWordLeave,
  onWordActivate,
}: WordSpansProps) {
  const segments = useMemo(() => segmentLine(text), [text]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.wordLike && isHanText(seg.text) ? (
          <button
            key={i}
            type="button"
            data-word={seg.text}
            aria-haspopup="dialog"
            aria-expanded={expandedKey === `${lineIndex}:${seg.start}`}
            aria-controls={expandedKey === `${lineIndex}:${seg.start}` ? "dictionary-dialog" : undefined}
            className="-my-1 cursor-pointer rounded-sm px-px py-1 hover:bg-primary/15"
            onMouseEnter={
              onWordEnter &&
              ((e) =>
                onWordEnter({
                  word: seg.text,
                  lineText: text,
                  start: seg.start,
                  lineIndex,
                  el: e.currentTarget,
                }))
            }
            onMouseLeave={onWordLeave}
            onClick={
              onWordActivate &&
              ((e) =>
                onWordActivate({
                  word: seg.text,
                  lineText: text,
                  start: seg.start,
                  lineIndex,
                  el: e.currentTarget,
                }))
            }
          >
            {seg.text}
          </button>
        ) : (
          seg.text
        ),
      )}
    </>
  );
}

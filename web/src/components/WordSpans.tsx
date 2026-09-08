import { memo, useCallback, useMemo } from "react";

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
  onWordEnter?: (info: WordHoverInfo) => void;
  onWordLeave?: () => void;
  /** Click/tap/Enter/Space — opens the dictionary dialog. */
  onWordActivate?: (info: WordHoverInfo) => void;
};

/**
 * One Han word button. Memoized so a parent line re-render (active
 * highlight, dialog open elsewhere) doesn't rebuild every word's closures —
 * the per-word handlers below are stable per button and only fire the
 * parent callback with the constructed info on actual interaction.
 */
const WordButton = memo(function WordButton({
  seg,
  lineText,
  lineIndex,
  expanded,
  onWordEnter,
  onWordLeave,
  onWordActivate,
}: {
  seg: TextSegment;
  lineText: string;
  lineIndex: number;
  expanded: boolean;
  onWordEnter?: (info: WordHoverInfo) => void;
  onWordLeave?: () => void;
  onWordActivate?: (info: WordHoverInfo) => void;
}) {
  const handleEnter = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      onWordEnter?.({
        word: seg.text,
        lineText,
        start: seg.start,
        lineIndex,
        el: e.currentTarget,
      });
    },
    [onWordEnter, seg.text, seg.start, lineText, lineIndex],
  );

  const handleActivate = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      onWordActivate?.({
        word: seg.text,
        lineText,
        start: seg.start,
        lineIndex,
        el: e.currentTarget,
      });
    },
    [onWordActivate, seg.text, seg.start, lineText, lineIndex],
  );

  return (
    <button
      type="button"
      data-word={seg.text}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-controls={expanded ? "dictionary-dialog" : undefined}
      className="-my-1 cursor-pointer rounded-sm px-px py-1 hover:bg-primary/15"
      onMouseEnter={onWordEnter ? handleEnter : undefined}
      onMouseLeave={onWordLeave}
      onClick={onWordActivate ? handleActivate : undefined}
    >
      {seg.text}
    </button>
  );
});

/**
 * Transcript text with Han words segmented into individually activatable
 * word buttons. Hover previews the definition on fine pointers; activating
 * the button opens the dictionary dialog (keyboard, click, and touch).
 *
 * Memoized: a line re-renders only when its own text/tokens/expanded state
 * change, so hover previews elsewhere don't rebuild every segment.
 */
export const WordSpans = memo(function WordSpans({
  text,
  tokens,
  lineIndex,
  expandedKey,
  onWordEnter,
  onWordLeave,
  onWordActivate,
}: WordSpansProps) {
  const segments = useMemo(() => tokens ?? segmentLine(text), [tokens, text]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.wordLike && isHanText(seg.text) ? (
          <WordButton
            key={i}
            seg={seg}
            lineText={text}
            lineIndex={lineIndex}
            expanded={expandedKey === `${lineIndex}:${seg.start}`}
            onWordEnter={onWordEnter}
            onWordLeave={onWordLeave}
            onWordActivate={onWordActivate}
          />
        ) : (
          seg.text
        ),
      )}
    </>
  );
});

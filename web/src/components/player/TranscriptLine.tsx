import { memo } from "react";

import { formatClock } from "../../lib/format";
import type { TranscriptLineData } from "../../lib/transcriptView";
import { WordSpans, type WordHoverInfo } from "../WordSpans";

type TranscriptLineProps = {
  line: TranscriptLineData;
  index: number;
  isActive: boolean;
  /** `${lineIndex}:${start}` key of the word whose dialog is open, if any. */
  dialogKey?: string | null;
  onSeek: (start: number) => void;
  onWordEnter: (info: WordHoverInfo) => void;
  onWordLeave: () => void;
  onWordActivate: (info: WordHoverInfo) => void;
};

/**
 * One transcript row, memoized; callers must pass stable callbacks/props.
 *
 * Seeking: clicking anywhere on the row (outside a button) seeks, and the
 * timestamp is a real button so keyboard users can seek too. Dictionary word
 * buttons are siblings — never nested — so each is independently
 * reachable by keyboard, mouse, and touch.
 */
export const TranscriptLine = memo(function TranscriptLine({
  line,
  index,
  isActive,
  dialogKey,
  onSeek,
  onWordEnter,
  onWordLeave,
  onWordActivate,
}: TranscriptLineProps) {
  const timeLabel = formatClock(line.start);
  return (
    <div
      role="listitem"
      aria-current={isActive ? true : undefined}
      className={`group flex cursor-pointer items-start gap-1 rounded-md px-2 py-1.5 leading-relaxed transition-colors duration-300 ${
        isActive ? "bg-primary/20" : "hover:bg-base-200"
      }`}
      onClick={(e) => {
        // Buttons in the row handle themselves; anything else seeks.
        if ((e.target as HTMLElement).closest("button")) return;
        onSeek(line.start);
      }}
    >
      <button
        type="button"
        onClick={() => onSeek(line.start)}
        aria-label={`Seek to ${timeLabel}`}
        title={`Seek to ${timeLabel}`}
        className="inline-flex min-h-11 shrink-0 items-center rounded px-1 text-xs text-base-content/50 tabular-nums select-none md:min-h-0 md:py-0.5"
      >
        <time>{timeLabel}</time>
      </button>
      <span className="min-w-0 flex-1">
        <WordSpans
          text={line.text}
          lineIndex={index}
          expandedKey={dialogKey}
          onWordEnter={onWordEnter}
          onWordLeave={onWordLeave}
          onWordActivate={onWordActivate}
        />
      </span>
    </div>
  );
});

import { memo } from "react";

import { formatClock } from "../../lib/format";
import { hasFinePointer } from "../../lib/mediaQueries";
import type { TranscriptLineData } from "../../lib/transcriptView";
import { WordSpans } from "../WordSpans";

type TranscriptLineProps = {
  line: TranscriptLineData;
  index: number;
  isActive: boolean;
  /** `${lineIndex}:${start}` key of the word whose dialog is open, if any. */
  dialogKey?: string | null;
  onSeek: (start: number) => void;
};

/**
 * One transcript row (<li> of the parent <ol>), memoized; callers must
 * pass stable callbacks/props.
 *
 * Seeking: the timestamp is a real button with a machine-readable
 * `dateTime`, and on hover-capable pointers clicking anywhere on the row
 * (outside a button) seeks too. On touch the row itself never seeks — a
 * missed word tap must not lose your place. Dictionary word buttons are
 * siblings — never nested — so each is independently reachable by
 * keyboard, mouse, and touch. Word hover/activation is handled by
 * delegated listeners on the parent <ol>, not per-row callbacks.
 */
export const TranscriptLine = memo(function TranscriptLine({
  line,
  index,
  isActive,
  dialogKey,
  onSeek,
}: TranscriptLineProps) {
  const timeLabel = formatClock(line.start);
  return (
    <li
      aria-current={isActive ? true : undefined}
      className={`group flex cursor-pointer items-start gap-1 rounded-md px-2 py-2 text-[18px] leading-[2] transition-colors duration-300 md:py-1.5 md:leading-relaxed [@media(hover:none)]:cursor-default ${
        isActive ? "bg-primary/30 shadow-[inset_3px_0_0_var(--color-primary)]" : "hover:bg-base-200"
      }`}
      onClick={(e) => {
        // Buttons in the row handle themselves; anything else seeks — but
        // only where hover exists (desktop). On touch, tapping line text
        // must never seek, or a missed word tap loses your place; the
        // timestamp button is the seek affordance there.
        if ((e.target as HTMLElement).closest("button")) return;
        if (!hasFinePointer()) return;
        onSeek(line.start);
      }}
    >
      <button
        type="button"
        onClick={() => onSeek(line.start)}
        aria-label={`Seek to ${timeLabel}`}
        title={`Seek to ${timeLabel}`}
        className="inline-flex min-h-11 shrink-0 items-center rounded px-1 text-xs text-base-content/60 tabular-nums select-none md:min-h-0 md:py-0.5"
      >
        <time dateTime={`PT${line.start}S`}>{timeLabel}</time>
      </button>
      <span className="min-w-0 flex-1">
        <WordSpans
          text={line.text}
          tokens={line.tokens}
          lineIndex={index}
          expandedKey={dialogKey}
        />
      </span>
      {isActive && <span className="sr-only"> (current line)</span>}
    </li>
  );
});

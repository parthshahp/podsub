import { memo, useEffect, useRef, useState } from "react";

import { loadDictionary, resolveSegment, type WordMatch } from "../lib/dictionary";
import { PlusIcon } from "./icons";

export type HoveredWord = {
  word: string;
  lineText: string;
  start: number;
  /** Transcript line index the word was hovered in (for sentence/audio). */
  lineIndex: number;
  /** Viewport rect of the hovered span, captured at hover time. */
  rect: { left: number; top: number; bottom: number; width: number };
};

const WIDTH = 320;
const GAP = 8;
/** Estimated max popover height, used to decide whether to flip above. */
const MAX_HEIGHT = 260;
const VIEWPORT_MARGIN = 12;

type Props = {
  hover: HoveredWord;
  /** Opened via click/tap/keyboard (owns focus) vs. transient hover preview. */
  dialog: boolean;
  /** Move focus into the dialog on open — true for activated words only. */
  focusOnOpen: boolean;
  /** Invoking word element — outside taps on it don't dismiss. */
  invoker?: HTMLElement | null;
  /** Dismiss the dialog (Esc, close button, outside tap). */
  onClose: () => void;
  /** Pointer moved onto the popover — keep it open. */
  onKeep: () => void;
  /** Pointer left the popover — schedule the same hide as leaving the word. */
  onLeave: () => void;
  /** Present when Anki is configured — sends the hovered word's card. */
  onAnki?: (sel: { word: string; pinyin: string; definition: string; lineIndex: number }) => void;
  ankiSending?: boolean;
};

/**
 * Dictionary card for a Chinese word: word · pinyin · definitions from the
 * lazily-loaded CC-CEDICT dictionary. Behaves as a non-modal dialog:
 * labelled, dismissible via Esc/close-button/outside-tap, with focus moved
 * in on activation and returned to the word on close.
 *
 * Memoized: the parent section re-renders on playback line changes, but
 * the popover only rebuilds when its own word or callbacks change.
 */
export const DefinitionPopover = memo(function DefinitionPopover({
  hover,
  dialog,
  focusOnOpen,
  invoker,
  onClose,
  onKeep,
  onLeave,
  onAnki,
  ankiSending,
}: Props) {
  // undefined = loading, null = no match
  const [match, setMatch] = useState<WordMatch | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    setMatch(undefined);
    setFailed(false);
    loadDictionary()
      .then((dict) => {
        if (!cancelled) setMatch(resolveSegment(dict, hover.lineText, hover.start, hover.word));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hover.word, hover.start, hover.lineText]);

  // Focus into the dialog when it opens via activation — never for hover
  // previews, which must not yank focus from the mouse user.
  useEffect(() => {
    if (dialog && focusOnOpen) closeRef.current?.focus();
  }, [dialog, focusOnOpen, hover.word, hover.start, hover.lineIndex]);

  // Esc dismisses in both modes.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Outside tap/click dismisses the activated dialog (touch path).
  useEffect(() => {
    if (!dialog) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      if (target && invoker && invoker.contains(target)) return;
      onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [dialog, invoker, onClose]);

  const pinyin = match?.entries.length
    ? [...new Set(match.entries.map((e) => e.pinyin))].join(" / ")
    : "";
  const definition = match?.entries.length
    ? match.entries.map((entry) => entry.definitions.join("/")).join(" / ")
    : "";

  // Clamp to the viewport: full width on desktop, fits 360px screens.
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 768;
  const width = Math.min(WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);
  const left = Math.min(
    Math.max(hover.rect.left - (width - hover.rect.width) / 2, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN),
  );
  const style = {
    left,
    width,
    ...(flipAbove(hover, viewportHeight)
      ? { bottom: viewportHeight - hover.rect.top + GAP }
      : { top: hover.rect.bottom + GAP }),
  };

  return (
    <div
      ref={rootRef}
      id="dictionary-dialog"
      role="dialog"
      aria-modal="false"
      aria-label={`Definition of ${match && match !== undefined ? match.word : hover.word}`}
      className="fixed z-30 max-w-[calc(100vw-2rem)] rounded-lg border border-base-300 bg-base-100 p-3 text-sm shadow-lg"
      style={style}
      onMouseEnter={onKeep}
      onMouseLeave={onLeave}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close definition"
        className="btn btn-ghost btn-xs btn-circle absolute top-1 right-1 min-h-11 min-w-11 md:min-h-8 md:min-w-8"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ×
        </span>
      </button>
      {failed ? (
        <p className="text-error">Dictionary failed to load.</p>
      ) : match === undefined ? (
        <span
          className="loading loading-dots loading-xs text-base-content/50"
          role="status"
          aria-label="Loading definition"
        />
      ) : match === null ? (
        <p className="text-base-content/50">No definition found</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2 pr-8">
            <span className="text-base font-medium">{match.word}</span>
            {match.entries.length === 1 ? (
              <span className="truncate text-xs text-primary/80">{match.entries[0].pinyin}</span>
            ) : (
              <span className="text-xs text-base-content/40">{match.entries.length} entries</span>
            )}
          </div>
          <div className="mt-1.5 max-h-52 space-y-1.5 overflow-y-auto">
            {match.entries.map((entry, i) => (
              <div key={i}>
                {match.entries.length > 1 && (
                  <p className="text-xs text-primary/80">{entry.pinyin}</p>
                )}
                <ul className="list-inside list-disc space-y-0.5 text-[13px] leading-snug text-base-content/80 marker:text-base-content/30">
                  {entry.definitions.map((def, j) => (
                    <li key={j}>{def}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[10px] text-base-content/40">CC-CEDICT · CC BY-SA 4.0</p>
            {onAnki && (
              <button
                className="btn btn-primary btn-sm min-h-11 rounded-full md:min-h-0"
                disabled={ankiSending}
                onClick={() =>
                  onAnki({ word: match.word, pinyin, definition, lineIndex: hover.lineIndex })
                }
              >
                {ankiSending ? (
                  <span className="loading loading-spinner loading-xs" aria-hidden="true" />
                ) : (
                  <PlusIcon className="h-3 w-3" />
                )}
                Anki
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
});

function flipAbove(hover: HoveredWord, viewportHeight: number): boolean {
  return hover.rect.bottom + GAP + MAX_HEIGHT > viewportHeight;
}

import { useCallback, useEffect, useRef, useState } from "react";

import type { HoveredWord } from "../components/DefinitionPopover";
import type { WordHoverInfo } from "../components/WordSpans";

/** A word opened via click/tap/keyboard, with its invoking element for focus return. */
export type DialogWord = HoveredWord & { invoker: HTMLElement };

/** True only on devices with a real hover capability (mouse, trackpad). */
function finePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;
}

/**
 * Dictionary popover state: transient hover preview (fine pointers only)
 * plus an activated dialog (click/tap/Enter/Space) that owns focus until
 * dismissed with Esc, the close button, or an outside tap.
 */
export function useWordHover() {
  const [hoveredWord, setHoveredWord] = useState<HoveredWord | null>(null);
  const [dialogWord, setDialogWord] = useState<DialogWord | null>(null);
  const showWordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideWordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invokerRef = useRef<HTMLElement | null>(null);

  useEffect(
    () => () => {
      if (showWordTimerRef.current) clearTimeout(showWordTimerRef.current);
      if (hideWordTimerRef.current) clearTimeout(hideWordTimerRef.current);
    },
    [],
  );

  const clearTimers = useCallback(() => {
    if (showWordTimerRef.current) clearTimeout(showWordTimerRef.current);
    if (hideWordTimerRef.current) clearTimeout(hideWordTimerRef.current);
  }, []);

  // Stable identities so memoized transcript rows don't re-render each tick.
  const handleWordEnter = useCallback(
    (info: WordHoverInfo) => {
      // Touch screens fire synthetic mouse events on tap — the tap path
      // (openWord) owns those; hover is a fine-pointer enhancement only.
      if (!finePointer()) return;
      if (hideWordTimerRef.current) clearTimeout(hideWordTimerRef.current);
      if (showWordTimerRef.current) clearTimeout(showWordTimerRef.current);
      showWordTimerRef.current = setTimeout(() => {
        const { el, ...word } = info;
        const { left, top, bottom, width } = el.getBoundingClientRect();
        setHoveredWord({ ...word, rect: { left, top, bottom, width } });
      }, 120);
    },
    [],
  );

  const handleWordLeave = useCallback(() => {
    if (showWordTimerRef.current) clearTimeout(showWordTimerRef.current);
    if (hideWordTimerRef.current) clearTimeout(hideWordTimerRef.current);
    hideWordTimerRef.current = setTimeout(() => setHoveredWord(null), 200);
  }, []);

  /** Hide immediately — scrolling leaves the captured rect stale. */
  const hideHoveredWord = useCallback(() => {
    if (showWordTimerRef.current) clearTimeout(showWordTimerRef.current);
    if (hideWordTimerRef.current) clearTimeout(hideWordTimerRef.current);
    setHoveredWord(null);
  }, []);

  /** Pointer moved onto the popover — cancel the pending hide. */
  const keepHover = useCallback(() => {
    if (hideWordTimerRef.current) clearTimeout(hideWordTimerRef.current);
  }, []);

  /** Open the dictionary dialog for a clicked/tapped/activated word. */
  const openWord = useCallback(
    (info: WordHoverInfo) => {
      clearTimers();
      setHoveredWord(null);
      const { left, top, bottom, width } = info.el.getBoundingClientRect();
      invokerRef.current = info.el;
      const { el: _el, ...word } = info;
      setDialogWord({ ...word, rect: { left, top, bottom, width }, invoker: info.el });
    },
    [clearTimers],
  );

  /** Close the dialog and return focus to the invoking word. */
  const closeDialog = useCallback(() => {
    setDialogWord(null);
    invokerRef.current?.focus();
    invokerRef.current = null;
  }, []);

  /**
   * Re-read the invoking word's rect after a scroll. The dialog captures
   * its position at open time, so without this a scrolled transcript
   * leaves the popover floating detached from its word.
   */
  const refreshDialogRect = useCallback(() => {
    const el = invokerRef.current;
    if (!el) return;
    const { left, top, bottom, width } = el.getBoundingClientRect();
    setDialogWord((prev) =>
      prev ? { ...prev, rect: { left, top, bottom, width } } : prev,
    );
  }, []);

  /** `${lineIndex}:${start}` key of the open dialog word, for aria-expanded. */
  const dialogKey = dialogWord ? `${dialogWord.lineIndex}:${dialogWord.start}` : null;

  return {
    hoveredWord,
    dialogWord,
    dialogKey,
    handleWordEnter,
    handleWordLeave,
    hideHoveredWord,
    keepHover,
    openWord,
    closeDialog,
    refreshDialogRect,
  };
}

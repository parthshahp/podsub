import { useCallback, useEffect, useRef, useState } from "react";

import { animateScrollTo } from "../lib/transcriptView";

/** Scroll positions this close to our own write count as ours. */
const SELF_SCROLL_EPSILON = 1;

/**
 * Transcript auto-follow: owns the scroll container ref and the follow flag,
 * easing the active line to the pane's center. Cancels in-flight animations
 * when the target changes so scrolls never fight.
 */
export function useTranscriptFollow(activeIdx: number) {
  const containerRef = useRef<HTMLOListElement | null>(null);
  const [follow, setFollow] = useState(true);
  const cancelScrollRef = useRef<(() => void) | null>(null);
  // Last position our easing wrote (post-clamp). Any `scroll` event at a
  // different position is the user's — dragging the native scrollbar,
  // flings, and find-in-page all fire `scroll` without `wheel`.
  const selfScrollTopRef = useRef<number | null>(null);

  useEffect(() => {
    if (!follow || activeIdx === -1) return;
    const container = containerRef.current;
    const el = container?.children[activeIdx] as HTMLElement | undefined;
    if (!container || !el) return;
    const containerRect = container.getBoundingClientRect();
    const target =
      container.scrollTop +
      el.getBoundingClientRect().top -
      containerRect.top -
      containerRect.height / 2 +
      el.getBoundingClientRect().height / 2;
    cancelScrollRef.current?.();
    cancelScrollRef.current = animateScrollTo(container, target, {
      onWrite: (top) => {
        selfScrollTopRef.current = top;
      },
    });
    return () => cancelScrollRef.current?.();
  }, [follow, activeIdx]);

  /** User scrolled — stop following until they seek or resume. */
  const handleUserScroll = useCallback(() => {
    cancelScrollRef.current?.();
    setFollow(false);
  }, []);

  /**
   * Scroll-event divert check: ignore the scrolls our own easing caused and
   * treat every other position change as the user taking over. Wheel/touch
   * already divert earlier; this catches what only fires `scroll` (the
   * native scrollbar above all). Calling it while follow is already off is
   * harmless — `setFollow(false)` is a no-op then.
   */
  const handleScrollDivert = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const own = selfScrollTopRef.current;
    if (own !== null && Math.abs(container.scrollTop - own) <= SELF_SCROLL_EPSILON) return;
    handleUserScroll();
  }, [handleUserScroll]);

  return { containerRef, follow, setFollow, handleUserScroll, handleScrollDivert };
}

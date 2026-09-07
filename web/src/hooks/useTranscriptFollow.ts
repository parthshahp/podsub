import { useCallback, useEffect, useRef, useState } from "react";

import { animateScrollTo } from "../lib/transcriptView";

/**
 * Transcript auto-follow: owns the scroll container ref and the follow flag,
 * easing the active line to the pane's center. Cancels in-flight animations
 * when the target changes so scrolls never fight.
 */
export function useTranscriptFollow(activeIdx: number) {
  const containerRef = useRef<HTMLOListElement | null>(null);
  const [follow, setFollow] = useState(true);
  const cancelScrollRef = useRef<(() => void) | null>(null);

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
    cancelScrollRef.current = animateScrollTo(container, target);
    return () => cancelScrollRef.current?.();
  }, [follow, activeIdx]);

  /** User scrolled — stop following until they seek or resume. */
  const handleUserScroll = useCallback(() => {
    cancelScrollRef.current?.();
    setFollow(false);
  }, []);

  return { containerRef, follow, setFollow, handleUserScroll };
}

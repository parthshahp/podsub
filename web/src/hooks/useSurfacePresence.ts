import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Keep a closing surface mounted for its CSS transition. CSS retargets
 * interrupted transitions from their current values; there is no animation
 * library, per-frame JS, or delayed keyboard interaction.
 */
export function useSurfacePresence(
  open: boolean,
  ref: RefObject<HTMLDivElement | null>,
  anchor?: RefObject<HTMLButtonElement | null>,
) {
  const [present, setPresent] = useState(open);
  useLayoutEffect(() => {
    if (open && !present) {
      setPresent(true);
      return;
    }
    const element = ref.current;
    if (!present || !element) return;

    if (open) {
      if (!element.dataset.motionState) {
        if (anchor?.current) {
          const panel = element.getBoundingClientRect();
          const trigger = anchor.current.getBoundingClientRect();
          const originX = Math.min(
            panel.width,
            Math.max(0, trigger.left + trigger.width / 2 - panel.left),
          );
          element.style.transformOrigin = `${originX}px 100%`;
        }
        element.style.transition = "none";
        element.dataset.motionState = "closed";
        // Establish the initial style once, before the opening transition.
        void element.offsetHeight;
        element.style.removeProperty("transition");
      }
      element.dataset.motionState = "open";
      return;
    }

    element.dataset.motionState = "closed";
    const style = getComputedStyle(element);
    const seconds = (value: string) =>
      value.endsWith("ms") ? parseFloat(value) : parseFloat(value) * 1000;
    const durations = style.transitionDuration.split(",").map(seconds);
    const delays = style.transitionDelay.split(",").map(seconds);
    const duration = Math.max(
      0,
      ...durations.map((value, i) => value + (delays[i % delays.length] ?? 0)),
    );
    if (!duration) {
      setPresent(false);
      return;
    }

    const finish = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === "opacity") setPresent(false);
    };
    element.addEventListener("transitionend", finish);
    // Covers background tabs and browsers that omit a transition event.
    const timer = window.setTimeout(() => setPresent(false), duration + 50);
    return () => {
      window.clearTimeout(timer);
      element.removeEventListener("transitionend", finish);
    };
  }, [open, present, ref, anchor]);
  return present;
}

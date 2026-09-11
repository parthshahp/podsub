/**
 * Cached `MediaQueryList` lookups.
 *
 * `window.matchMedia` is `[NewObject]`: every call parses the query, allocates
 * a list, and registers it with the document so it can be re-checked on each
 * media evaluation. Hot paths (per mouseover, per row click, per auto-scroll)
 * shouldn't pay that, so each list is built once and reused.
 *
 * Only the *list* is cached, never `matches`: a `MediaQueryList` is live, so
 * reading `.matches` still reflects a mouse being plugged in or a
 * reduced-motion toggle. Lists are created on first read, never at module
 * scope, so importing this module is safe outside the browser (SSR, tests).
 */

let hoverPointerList: MediaQueryList | null = null;
let reducedMotionList: MediaQueryList | null = null;

/** True only on devices with a real hover capability (mouse, trackpad). */
export function hasFinePointer(): boolean {
  if (typeof window === "undefined") return false;
  hoverPointerList ??= window.matchMedia("(hover: hover)");
  return hoverPointerList.matches;
}

/** True when the user has asked for reduced motion; re-read, never frozen. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  reducedMotionList ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return reducedMotionList.matches;
}

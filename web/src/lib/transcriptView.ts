import type { LineToken, Word } from "../types";
import { TAIL_SEC, blobToBase64 } from "./audioClip";
import { prefersReducedMotion } from "./mediaQueries";

/** A single transcript row: start time plus display text.
 * `tokens` are server-side jieba segments when present; the client falls
 * back to Intl.Segmenter for lines without them. */
export type TranscriptLineData = { start: number; text: string; tokens?: LineToken[] };

type AnimateScrollOptions = {
  duration?: number;
  /**
   * Called with every position this animation writes, already read back
   * (so clamped to the scrollable range). Lets the caller tell its own
   * scrolls from the user's in a `scroll` handler.
   */
  onWrite?: (top: number) => void;
};

/** Ease-in-out cubic scroll; re-invoking cancels the previous run. */
export function animateScrollTo(
  container: HTMLElement,
  target: number,
  { duration = 300, onWrite }: AnimateScrollOptions = {},
) {
  const start = container.scrollTop;
  const delta = target - start;
  // Report the post-clamp value actually in effect: a target past the end
  // must not read back as a scroll position we never wrote.
  const write = (top: number) => {
    container.scrollTop = top;
    onWrite?.(container.scrollTop);
  };
  // Read reduced motion at animation start; the cached list keeps `.matches` live.
  if (prefersReducedMotion() || duration <= 0 || Math.abs(delta) < 1) {
    write(target);
    return () => {};
  }
  let raf = 0;
  const t0 = performance.now();
  function tick(now: number) {
    const t = Math.min((now - t0) / duration, 1);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    write(start + delta * eased);
    if (t < 1) raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** End time for a line's clip: last word's end + tail, or the next line's start. */
export function lineEndSec(
  line: TranscriptLineData,
  nextLine: TranscriptLineData | undefined,
  words: Word[],
): number {
  const nextStart = nextLine?.start ?? Infinity;
  let end = 0;
  for (const w of words) {
    if (w.start >= line.start && w.start < nextStart) end = Math.max(end, w.end);
  }
  if (end === 0) end = Number.isFinite(nextStart) ? nextStart : line.start + 5;
  return end + TAIL_SEC;
}

/** Binary search for the last line with start <= t (-1 when none). */
export function findActiveLineIndex(lines: TranscriptLineData[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    // `lo <= mid <= hi` and `hi < lines.length`, so `mid` always indexes a line.
    const line = lines[mid]!;
    if (line.start <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

const IMAGE_EXTS: Array<[needle: string, ext: string]> = [
  ["png", "png"],
  ["webp", "webp"],
  ["gif", "gif"],
];

/** Fetch artwork via the server proxy (CDNs rarely send CORS headers) for Anki media. */
export async function loadPodcastImage(
  podcastId: string,
): Promise<{ base64: string; ext: string }> {
  const res = await fetch(`/api/podcasts/${podcastId}/image`);
  if (!res.ok) throw new Error(`Image download failed (HTTP ${res.status})`);
  const type = res.headers.get("content-type") ?? "";
  const ext = IMAGE_EXTS.find(([needle]) => type.includes(needle))?.[1] ?? "jpg";
  return { base64: await blobToBase64(await res.blob()), ext };
}

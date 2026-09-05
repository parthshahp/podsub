/** Chinese word segmentation via Intl.Segmenter — no jieba dependency needed. */

export type TextSegment = {
  text: string;
  /** True when ICU classifies this as a word (vs. punctuation/whitespace). */
  wordLike: boolean;
  /** Char offset of the segment within the input text. */
  start: number;
};

let segmenter: Intl.Segmenter | undefined;

function getSegmenter(): Intl.Segmenter {
  segmenter ??= new Intl.Segmenter("zh", { granularity: "word" });
  return segmenter;
}

// Lines re-render on every playback tick; memoize by text.
const cache = new Map<string, TextSegment[]>();
const CACHE_LIMIT = 5000;

export function segmentLine(text: string): TextSegment[] {
  const hit = cache.get(text);
  if (hit) return hit;

  const segments: TextSegment[] = [];
  for (const { segment, index, isWordLike } of getSegmenter().segment(text)) {
    segments.push({ text: segment, wordLike: isWordLike ?? false, start: index });
  }

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(text, segments);
  return segments;
}

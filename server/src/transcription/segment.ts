import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict";
import type { LineToken } from "@podsub/schemas";

/** A display line with optional server-side segmentation attached. */
export type SegmentedLine = {
  start: number;
  text: string;
  tokens?: LineToken[];
};

const HAN = /\p{Script=Han}/u;
// Letters/numbers count as words (mirrors Intl.Segmenter isWordLike);
// punctuation/whitespace do not.
const WORDLIKE = /[\p{L}\p{N}]/u;

// Singleton: the default dict loads once (~ms), shared by all requests.
let jieba: Jieba | null = null;

function getJieba(): Jieba {
  jieba ??= Jieba.withDict(dict);
  return jieba;
}

export function isZhLanguage(language: string | null | undefined): boolean {
  return language?.toLowerCase().startsWith("zh") ?? false;
}

/**
 * Segment one display line with jieba, recovering UTF-16 char offsets by
 * walking `cut()` output with a cursor (jieba is lossless, so each part is
 * found exactly at the cursor). Returns undefined for lines without Han —
 * Intl.Segmenter already handles those perfectly, so emitting tokens would
 * only add bytes — or when jieba normalizes unexpectedly, letting the
 * client fall back instead of rendering garbage.
 */
export function cutForDisplay(text: string): LineToken[] | undefined {
  if (!HAN.test(text)) return undefined;
  const parts = getJieba().cut(text, true);
  const tokens: LineToken[] = [];
  let cursor = 0;
  for (const part of parts) {
    if (!part) continue;
    const idx = text.indexOf(part, cursor);
    if (idx === -1) return undefined;
    if (idx > cursor) {
      const gap = text.slice(cursor, idx);
      tokens.push({ text: gap, start: cursor, wordLike: WORDLIKE.test(gap) });
    }
    tokens.push({ text: part, start: idx, wordLike: WORDLIKE.test(part) });
    cursor = idx + part.length;
  }
  if (cursor < text.length) {
    const tail = text.slice(cursor);
    tokens.push({ text: tail, start: cursor, wordLike: WORDLIKE.test(tail) });
  }
  return tokens;
}

/**
 * Attach display tokens to transcript lines. A line is segmented when the
 * transcript language is zh* or the line itself contains Han; everything
 * else omits `tokens` so the client falls back to Intl.Segmenter.
 */
export function segmentLines(
  lines: { start: number; text: string }[],
  language: string | null,
): SegmentedLine[] {
  const zh = isZhLanguage(language);
  return lines.map((line) => {
    if (!zh && !HAN.test(line.text)) return line;
    const tokens = cutForDisplay(line.text);
    return tokens ? { ...line, tokens } : line;
  });
}

// Read-time segmentation is ~ms per episode, but cache it anyway so every
// client polling the same transcript shares the work. Keyed by
// episodeId:updatedAt, so a re-transcription naturally misses.
const lineCache = new Map<string, SegmentedLine[]>();
const CACHE_LIMIT = 20;

export function getSegmentedLines(
  episodeId: string,
  updatedAt: number,
  lines: { start: number; text: string }[],
  language: string | null,
): SegmentedLine[] {
  const key = `${episodeId}:${updatedAt}`;
  const hit = lineCache.get(key);
  if (hit) return hit;
  const segmented = segmentLines(lines, language);
  if (lineCache.size >= CACHE_LIMIT) {
    const oldest = lineCache.keys().next();
    if (!oldest.done) lineCache.delete(oldest.value);
  }
  lineCache.set(key, segmented);
  return segmented;
}

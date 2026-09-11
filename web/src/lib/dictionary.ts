/**
 * Dictionary lookup over web/public/zh-dict.json (from CC-CEDICT):
 * exact match → greedy longest-prefix → single character.
 */

import { hasFinePointer } from "./mediaQueries";

export type DictEntry = {
  traditional: string;
  pinyin: string;
  definitions: string[];
};

export type WordMatch = {
  word: string;
  entries: DictEntry[];
};

type DictData = {
  entries: [traditional: string, pinyin: string, defs: string][];
  simp: Record<string, number[]>;
  trad: Record<string, number[]>;
};

export const isHanText = (text: string): boolean => /\p{Script=Han}/u.test(text);

export class Dictionary {
  private data: DictData;
  private cache = new Map<string, WordMatch | null>();
  private readonly maxWordLength: number;

  constructor(data: DictData) {
    this.data = data;
    let max = 1;
    for (const headword of Object.keys(data.simp)) {
      max = Math.max(max, [...headword].length);
    }
    this.maxWordLength = max;
  }

  /** Exact lookup by simplified or traditional headword. */
  lookupExact(word: string): WordMatch | null {
    if (this.cache.has(word)) return this.cache.get(word)!;
    let match: WordMatch | null = null;
    const indices = this.data.simp[word] ?? this.data.trad[word];
    if (indices?.length) {
      match = { word, entries: indices.map((i) => this.entryAt(i)) };
    }
    this.cache.set(word, match);
    return match;
  }

  /** Greedy longest match starting at `start`, longest substring first. */
  longestMatch(text: string, start: number): WordMatch | null {
    const chars = Array.from(text.slice(start));
    const limit = Math.min(chars.length, this.maxWordLength);
    for (let length = limit; length >= 1; length--) {
      const candidate = chars.slice(0, length).join("");
      const match = this.lookupExact(candidate);
      if (match) return match;
    }
    return null;
  }

  private entryAt(index: number): DictEntry {
    // `index` comes from `simp`/`trad`, which only ever hold indices into `entries`.
    const [traditional, pinyin, defs] = this.data.entries[index]!;
    return { traditional, pinyin, definitions: defs.split("/") };
  }
}

let dictPromise: Promise<Dictionary> | null = null;

/** Fetches and parses the dictionary once; subsequent calls reuse it. */
export function loadDictionary(): Promise<Dictionary> {
  dictPromise ??= fetch("/zh-dict.json")
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load dictionary: ${res.status}`);
      return res.json() as Promise<DictData>;
    })
    .then((data) => new Dictionary(data));
  return dictPromise;
}

let prefetchHandle: number | null = null;

/**
 * Warms the 13 MB dictionary during browser idle so the first word hover
 * doesn't stall on the download. No-op without a hover-capable pointer: touch
 * users can't hover, and the tap that opens the dialog makes the wait explicit
 * (they'd otherwise pay the bandwidth on every episode they merely open).
 *
 * Idempotent — a hover during or after the prefetch joins the same request via
 * `loadDictionary`'s promise — and cancellable: the returned function stops a
 * prefetch that hasn't started yet.
 */
export function prefetchDictionary(): () => void {
  const noop = () => {};
  if (typeof window === "undefined" || prefetchHandle !== null || dictPromise) return noop;
  if (!hasFinePointer()) return noop;

  const start = () => {
    prefetchHandle = null;
    loadDictionary().catch(() => {
      // A background failure must not poison the on-demand path: clear the
      // rejected promise so the next hover fetches again.
      dictPromise = null;
    });
  };

  // requestIdleCallback is Safari-excluded; the timeout keeps that prefetch
  // off the critical path there too.
  const idleCallback = typeof window.requestIdleCallback === "function";
  prefetchHandle = idleCallback
    ? window.requestIdleCallback(start, { timeout: 3000 })
    : window.setTimeout(start, 2000);

  return () => {
    if (prefetchHandle === null) return;
    if (idleCallback) window.cancelIdleCallback(prefetchHandle);
    else window.clearTimeout(prefetchHandle);
    prefetchHandle = null;
  };
}

/** Exact segment → longest-prefix backoff → single character. */
export function resolveSegment(
  dict: Dictionary,
  text: string,
  start: number,
  segment: string,
): WordMatch | null {
  // First character of `segment`; undefined only for an empty segment (never
  // produced by Intl.Segmenter), where the chain below has nothing left to try.
  const head = [...segment][0];
  return (
    dict.lookupExact(segment) ??
    dict.longestMatch(text, start) ??
    (head === undefined ? null : dict.lookupExact(head))
  );
}

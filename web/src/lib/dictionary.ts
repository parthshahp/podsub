/**
 * Dictionary lookup over web/public/zh-dict.json (from CC-CEDICT):
 * exact match → greedy longest-prefix → single character.
 */

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
    const [traditional, pinyin, defs] = this.data.entries[index];
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

/** Exact segment → longest-prefix backoff → single character. */
export function resolveSegment(
  dict: Dictionary,
  text: string,
  start: number,
  segment: string,
): WordMatch | null {
  return (
    dict.lookupExact(segment) ?? dict.longestMatch(text, start) ?? dict.lookupExact([...segment][0])
  );
}

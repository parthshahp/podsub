/**
 * Downloads CC-CEDICT and converts it to web/public/zh-dict.json.
 * CC-CEDICT is CC BY-SA 4.0 — the generated file must keep that attribution.
 * Output: { entries: [trad, pinyin, defs][], simp: idx[], trad: idx[] }
 * Run: pnpm --filter @podsub/server build:dict
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const CEDICT_URL = "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz";
const OUT_PATH = path.resolve(import.meta.dirname, "../../web/public/zh-dict.json");

/** Vowel → tone-marked variants, indexed by tone 1–4. */
const TONE_VOWELS: Record<string, [string, string, string, string]> = {
  a: ["ā", "á", "ǎ", "à"],
  e: ["ē", "é", "ě", "è"],
  i: ["ī", "í", "ǐ", "ì"],
  o: ["ō", "ó", "ǒ", "ò"],
  u: ["ū", "ú", "ǔ", "ù"],
  ü: ["ǖ", "ǘ", "ǚ", "ǜ"],
};

const VOWELS = ["a", "e", "i", "o", "u", "ü"] as const;

/**
 * Converts one numbered syllable ("hao3") to tone-marked ("hǎo").
 * Mark goes on "a", else the "o" of "ou", else the last vowel.
 */
function toneMarkSyllable(syllable: string): string {
  const tone = Number(syllable.at(-1));
  if (!Number.isInteger(tone)) return syllable;
  const base = syllable.slice(0, -1).replaceAll("u:", "ü");
  if (tone === 5 || tone === 0) return base;
  if (tone < 1 || tone > 4) return syllable;

  const lower = base.toLowerCase();
  let idx = lower.indexOf("a");
  if (idx === -1) {
    idx = lower.indexOf("ou");
  }
  if (idx === -1) {
    for (const v of VOWELS) {
      idx = Math.max(idx, lower.lastIndexOf(v));
    }
  }
  if (idx < 0 || idx >= base.length) return syllable;

  const ch = base[idx];
  const marked = TONE_VOWELS[ch.toLowerCase()]?.[tone - 1];
  if (!marked) return syllable;
  return (
    base.slice(0, idx) + (ch === lower[idx] ? marked : marked.toUpperCase()) + base.slice(idx + 1)
  );
}

/** Converts a full pinyin string ("ni3 hao3") to tone marks ("nǐ hǎo"). */
function convertPinyin(pinyin: string): string {
  return pinyin
    .split(" ")
    .map((token) =>
      // Multi-reading entries use "/" inside the brackets: [xing2/hang2]
      token.split("/").map(toneMarkSyllable).join("/"),
    )
    .join(" ");
}

type RawEntry = { trad: string; simp: string; pinyin: string; defs: string[] };

const LINE_RE = /^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.*)\/$/;

function parseLine(line: string): RawEntry | null {
  const match = LINE_RE.exec(line);
  if (!match) return null;
  const [, trad, simp, pinyin, defs] = match;
  return { trad, simp, pinyin: convertPinyin(pinyin), defs: defs.split("/") };
}

type EntryTuple = [traditional: string, pinyin: string, definitions: string];

async function main() {
  process.stdout.write(`Downloading ${CEDICT_URL}…\n`);
  const res = await fetch(CEDICT_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");

  const entries: EntryTuple[] = [];
  const simpIndex = new Map<string, number[]>();
  const tradIndex = new Map<string, number[]>();

  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const entry = parseLine(line);
    if (!entry) {
      skipped++;
      continue;
    }
    const index = entries.length;
    entries.push([entry.trad, entry.pinyin, entry.defs.join("/")]);
    simpIndex.set(entry.simp, [...(simpIndex.get(entry.simp) ?? []), index]);
    tradIndex.set(entry.trad, [...(tradIndex.get(entry.trad) ?? []), index]);
  }

  const data = JSON.stringify({
    entries,
    simp: Object.fromEntries(simpIndex),
    trad: Object.fromEntries(tradIndex),
  });

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, data);
  process.stdout.write(
    `Wrote ${OUT_PATH}\n  ${entries.length} entries, ${(data.length / 1024 / 1024).toFixed(1)} MB, ${skipped} lines skipped\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

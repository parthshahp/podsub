import type { Word } from "@podsub/schemas";
import { MAX_LINE_SECONDS } from "../config.js";

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const NO_SPACE_BEFORE = /^[,.;:!?%)\]}'”’、。，！？：；…]/;
const NO_SPACE_AFTER = /[([{'“‘（「『]$/;

/** Join ASR words without introducing spaces inside CJK text. */
export function appendWordToLine(text: string, word: string): string {
  if (!text) return word;
  if (/^\s/.test(word) || /\s$/.test(text)) return text + word;
  if (NO_SPACE_BEFORE.test(word)) return text + word;
  if (NO_SPACE_AFTER.test(text)) return text + word;
  if (CJK.test(text.at(-1) ?? "") && CJK.test(word[0] ?? "")) return text + word;
  return text + " " + word;
}

export type TranscriptPassage = {
  start: number;
  end: number;
  text: string;
  firstWord: number;
  lastWord: number;
};

/** Search and display share exactly the same sentence/time boundaries. */
export function groupWordsIntoPassages(words: Word[]): TranscriptPassage[] {
  const passages: TranscriptPassage[] = [];
  let text = "";
  let firstWord = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (!text) firstWord = i;
    text = appendWordToLine(text, word.word);
    if (/[。！？.!?]/.test(word.word) || word.end - words[firstWord]!.start > MAX_LINE_SECONDS) {
      passages.push({
        start: words[firstWord]!.start,
        end: word.end,
        text,
        firstWord,
        lastWord: i,
      });
      text = "";
    }
  }
  if (text) {
    passages.push({
      start: words[firstWord]!.start,
      end: words.at(-1)!.end,
      text,
      firstWord,
      lastWord: words.length - 1,
    });
  }
  return passages;
}

export function groupWordsIntoLines(words: Word[]): { start: number; text: string }[] {
  return groupWordsIntoPassages(words).map(({ start, text }) => ({ start, text }));
}

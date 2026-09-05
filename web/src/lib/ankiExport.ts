import type { AnkiNote } from "./anki";
import { CARD_SOURCES, type AnkiSettings, type CardSource } from "./ankiSettings";
import { formatClock } from "./format";

/** Values podsub can fill a note's fields with, keyed by card source. */
export type CardData = Record<CardSource, string>;

/** Per-line data a card can be built from; word-only sources are empty for line exports. */
export type CardInput = {
  lineText: string;
  lineStart: number;
  podcastTitle: string;
  episodeTitle: string;
  /** `[sound:…]` tag for the line's clip; omitted when audio isn't attached. */
  audio?: string;
  /** Hovered word's headword, pinyin, and definitions. */
  word?: string;
  pinyin?: string;
  definition?: string;
  /** `<img>` HTML referencing attached picture media; empty when none. */
  image?: string;
};

export function buildCardData(input: CardInput): CardData {
  return {
    sentence: input.lineText,
    word: input.word ?? "",
    pinyin: input.pinyin ?? "",
    definition: input.definition ?? "",
    podcastTitle: input.podcastTitle,
    episodeTitle: input.episodeTitle,
    timestamp: formatClock(input.lineStart),
    audio: input.audio ?? "",
    image: input.image ?? "",
  };
}

export function isConfigured(settings: AnkiSettings): boolean {
  return (
    settings.deck !== "" &&
    settings.noteType !== "" &&
    Object.values(settings.mappings).some((source) => CARD_SOURCES.includes(source))
  );
}

/** Build an addNotes payload from the saved field mappings. */
export function buildNote(settings: AnkiSettings, card: CardData): AnkiNote {
  const fields: Record<string, string> = {};
  for (const [field, source] of Object.entries(settings.mappings)) {
    fields[field] = card[source];
  }
  return {
    deckName: settings.deck,
    modelName: settings.noteType,
    fields,
    options: { allowDuplicate: false },
  };
}

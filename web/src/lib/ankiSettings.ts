// Card sources podsub can fill a note field with (line-derived, plus the
// hovered word's dictionary data).
export const CARD_SOURCES = [
  "sentence",
  "word",
  "pinyin",
  "definition",
  "podcastTitle",
  "episodeTitle",
  "timestamp",
  "audio",
  "image",
] as const;
export type CardSource = (typeof CARD_SOURCES)[number];

export const SOURCE_LABELS: Record<CardSource, string> = {
  sentence: "Sentence (transcript line)",
  word: "Word (hovered)",
  pinyin: "Pinyin (hovered word)",
  definition: "Definition (hovered word)",
  podcastTitle: "Podcast title",
  episodeTitle: "Episode title",
  timestamp: "Timestamp (mm:ss)",
  audio: "Audio clip ([sound:…] mp3)",
  image: "Podcast image (<img> HTML)",
};

export type AnkiSettings = {
  deck: string;
  noteType: string;
  /** Anki note field name → card source; unmapped fields are omitted. */
  mappings: Record<string, CardSource>;
};

const STORAGE_KEY = "ankiSettings";

/** Drops field mappings whose card source is no longer a known one. */
function sanitizeMappings(mappings: Record<string, CardSource>): Record<string, CardSource> {
  return Object.fromEntries(
    Object.entries(mappings).filter(([, source]) => CARD_SOURCES.includes(source)),
  );
}

export function loadAnkiSettings(): AnkiSettings {
  const defaults: AnkiSettings = {
    deck: "",
    noteType: "",
    mappings: {},
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    // Tolerates the older shape, which included a `url` field.
    const parsed = JSON.parse(raw) as Partial<AnkiSettings>;
    return {
      deck: parsed.deck ?? "",
      noteType: parsed.noteType ?? "",
      // A stale source would make buildNote write `undefined` into a field.
      mappings: sanitizeMappings(parsed.mappings ?? {}),
    };
  } catch {
    return defaults;
  }
}

export function saveAnkiSettings(settings: AnkiSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Non-fatal: private browsing and disabled/full storage reject writes.
  }
}

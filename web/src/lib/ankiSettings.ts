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

export const DEFAULT_URL = "http://127.0.0.1:8765";

export type AnkiSettings = {
  url: string;
  deck: string;
  noteType: string;
  /** Anki note field name → card source; unmapped fields are omitted. */
  mappings: Record<string, CardSource>;
};

const STORAGE_KEY = "ankiSettings";

export function loadAnkiSettings(): AnkiSettings {
  const defaults: AnkiSettings = {
    url: DEFAULT_URL,
    deck: "",
    noteType: "",
    mappings: {},
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<AnkiSettings>;
    return {
      url: parsed.url || defaults.url,
      deck: parsed.deck ?? "",
      noteType: parsed.noteType ?? "",
      mappings: parsed.mappings ?? {},
    };
  } catch {
    return defaults;
  }
}

export function saveAnkiSettings(settings: AnkiSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

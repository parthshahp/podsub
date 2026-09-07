import path from "node:path";

// Anchor to server/src/ so paths are cwd-independent.
const ROOT = path.resolve(import.meta.dirname, "../..");

// Where downloaded episode audio is cached (keyed by episode id).
export const PODCASTS_DIR = path.join(ROOT, "podcasts");

// Built web UI (Vite output). Absent until `pnpm build` runs.
export const WEB_DIST_DIR = path.join(ROOT, "web", "dist");

export const MODEL = "microsoft/mai-transcribe-2";

// Long audio times out upstream, so split before sending.
export const CHUNK_SECONDS = 300;

// Files untouched this long are evicted; a miss just re-streams upstream.
export const AUDIO_CACHE_TTL_MS = 1 * 60 * 60 * 1000;

// Sweep interval. Crash-orphaned partials are reaped sooner (PART_ORPHAN_MS).
export const AUDIO_CACHE_SWEEP_MS = 2 * 60 * 60 * 1000;

// Group words into display lines after this many seconds without punctuation.
export const MAX_LINE_SECONDS = 12;

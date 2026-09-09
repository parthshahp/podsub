import path from "node:path";

// Anchor to server/src/ so paths are cwd-independent.
const ROOT = path.resolve(import.meta.dirname, "../..");

// Where downloaded episode audio is cached (keyed by episode id).
export const PODCASTS_DIR = path.join(ROOT, "podcasts");

// Built web UI (Vite output). Absent until `pnpm build` runs.
export const WEB_DIST_DIR = path.join(ROOT, "web", "dist");

export const MODEL = "microsoft/mai-transcribe-2";

// Models the server will accept for transcription (per-request override via
// POST /api/episodes/:id/transcribe { model }). Transcripts are keyed by
// (episode_id, model, language) and the latest one wins, so trying a second
// model never destroys the first transcript.
export const TRANSCRIBE_MODELS = [MODEL, "qwen/qwen3-asr-1.7b"] as const;
export type TranscribeModel = (typeof TRANSCRIBE_MODELS)[number];

export function isTranscribeModel(value: string): value is TranscribeModel {
  return (TRANSCRIBE_MODELS as readonly string[]).includes(value);
}

// Long audio must be split before sending. Measured ceiling for
// mai-transcribe-2 via OpenRouter is ~32.5 min/request (larger → HTTP 400
// "does not support large audio inputs"); 30 min leaves margin. Processing
// is ~170× realtime, so a 30-min chunk takes ~10s, far under the 60s
// upstream timeout.
export const CHUNK_SECONDS = 1800;

// Space out chunk requests; OpenRouter providers 429 on rapid same-model fire.
export const CHUNK_DELAY_MS = 2_000;

// Files untouched this long are evicted; a miss just re-streams upstream.
export const AUDIO_CACHE_TTL_MS = 1 * 60 * 60 * 1000;

// Sweep interval. Crash-orphaned partials are reaped sooner (PART_ORPHAN_MS).
export const AUDIO_CACHE_SWEEP_MS = 2 * 60 * 60 * 1000;

// Group words into display lines after this many seconds without punctuation.
export const MAX_LINE_SECONDS = 12;

// Per-request timeout for AnkiConnect forwards. Syncs can take a while on
// large collections; addNotes/version/decks are local and fast.
export const ANKI_TIMEOUT_MS = 30_000;
export const ANKI_SYNC_TIMEOUT_MS = 120_000;

// AnkiConnect upstream for the same-origin /api/anki proxy. Server-side only
// (the client never influences the dial target, so the proxy can't become an
// open relay). Point it at whichever machine runs Anki — loopback by default,
// a LAN host if Anki lives elsewhere, e.g. ANKI_CONNECT_URL=http://192.168.1.103:8765.
export const ANKI_CONNECT_URL = process.env.ANKI_CONNECT_URL ?? "http://127.0.0.1:8765";

// addNotes carries base64 audio/image inline; clips are short, but stay generous.
export const ANKI_MAX_BODY_BYTES = 32 * 1024 * 1024;

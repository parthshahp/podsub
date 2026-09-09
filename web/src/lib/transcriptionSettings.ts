// Preferred transcription model, persisted in localStorage and sent with
// every POST /api/episodes/:id/transcribe request. Mirrors the shape of
// ankiSettings.ts. Unknown stored values fall back to the default so an
// outdated entry can never break transcription.

export const TRANSCRIBE_MODEL_OPTIONS = [
  { value: "microsoft/mai-transcribe-2", label: "MAI Transcribe 2 (default)" },
  { value: "qwen/qwen3-asr-1.7b", label: "Qwen3 ASR 1.7B" },
] as const;

export const DEFAULT_TRANSCRIBE_MODEL: string = TRANSCRIBE_MODEL_OPTIONS[0].value;

const STORAGE_KEY = "transcriptionModel";

function isKnownModel(value: string): boolean {
  return TRANSCRIBE_MODEL_OPTIONS.some((o) => o.value === value);
}

export function loadTranscriptionModel(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isKnownModel(raw)) return raw;
  } catch {
    // Private browsing etc. — fall through to the default.
  }
  return DEFAULT_TRANSCRIBE_MODEL;
}

export function saveTranscriptionModel(model: string): void {
  if (!isKnownModel(model)) return;
  try {
    localStorage.setItem(STORAGE_KEY, model);
  } catch {
    // Non-fatal: the default is used when nothing is stored.
  }
}

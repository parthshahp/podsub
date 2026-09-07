// AnkiConnect client via the same-origin proxy (POST /api/anki).
// The browser never talks to Anki directly, so no CORS is involved; the
// server forwards to its configured ANKI_CONNECT_URL.

const VERSION = 6;

/** Note payload for the addNotes action. */
export type AnkiNote = {
  deckName: string;
  modelName: string;
  /** Only mapped fields are included. */
  fields: Record<string, string>;
  /** Media files carried inline (base64). */
  audio?: Array<{ data: string; filename: string }>;
  /** Inline images; reference via `<img src=filename>`. */
  picture?: Array<{ data: string; filename: string }>;
  options?: { allowDuplicate?: boolean };
};

export async function invoke<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/anki", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, version: VERSION, params }),
    });
  } catch {
    throw new Error("Could not reach the Anki proxy. Is the podsub server running?");
  }
  if (res.status === 502) {
    throw new Error(
      "Could not reach AnkiConnect. Is Anki running with the AnkiConnect add-on installed?",
    );
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    const message =
      detail && typeof detail.error === "string" ? detail.error : `HTTP ${res.status}`;
    throw new Error(`Anki request failed: ${message}`);
  }

  const body = (await res.json()) as { result: T; error: string | null };
  if (body.error) throw new Error(body.error);
  return body.result;
}

export const getVersion = () => invoke<number>("version");

export const getDeckNames = () => invoke<string[]>("deckNames");

export const getModelNames = () => invoke<string[]>("modelNames");

export const getModelFieldNames = (modelName: string) =>
  invoke<string[]>("modelFieldNames", { modelName });

/** Returns one note id per input, or null for notes that failed to add. */
export const addNotes = (notes: AnkiNote[]) =>
  invoke<Array<number | null>>("addNotes", { notes });

/** Sync the local collection with AnkiWeb. Resolves null on success. */
export const syncAnkiWeb = () => invoke<null>("sync");

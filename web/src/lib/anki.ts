// AnkiConnect client: browser → Anki's local HTTP server (default
// http://127.0.0.1:8765, which allows localhost origins).

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

export async function invoke<T>(
  url: string,
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ action, version: VERSION, params }),
    });
  } catch {
    throw new Error(
      `Could not reach AnkiConnect at ${url}. Is Anki running with the AnkiConnect add-on installed?`,
    );
  }
  if (!res.ok) throw new Error(`AnkiConnect returned HTTP ${res.status}`);

  const body = (await res.json()) as { result: T; error: string | null };
  if (body.error) throw new Error(body.error);
  return body.result;
}

export const getVersion = (url: string) => invoke<number>(url, "version");

export const getDeckNames = (url: string) => invoke<string[]>(url, "deckNames");

export const getModelNames = (url: string) => invoke<string[]>(url, "modelNames");

export const getModelFieldNames = (url: string, modelName: string) =>
  invoke<string[]>(url, "modelFieldNames", { modelName });

/** Returns one note id per input, or null for notes that failed to add. */
export const addNotes = (url: string, notes: AnkiNote[]) =>
  invoke<Array<number | null>>(url, "addNotes", { notes });

/** Sync the local collection with AnkiWeb. Resolves null on success. */
export const syncAnkiWeb = (url: string) => invoke<null>(url, "sync");

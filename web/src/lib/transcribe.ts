import { api } from "../api";
import { loadTranscriptionModel } from "./transcriptionSettings";

/**
 * Enqueue a transcription job for an episode (202 once registered).
 * Sends the model selected in Settings; the server falls back to its
 * default when the body is absent. Throws with a human-readable message
 * on failure — callers keep their own pending/error UI state around this.
 */
export async function requestTranscription(episodeId: string): Promise<void> {
  // The route parses the body leniently at runtime (missing body → default
  // model, so older UIs keep working), so its inferred input type has no
  // `json` key — the cast is safe: the hono client still sends it as the body.
  const res = await api.api.episodes[":id"].transcribe.$post({
    param: { id: episodeId },
    json: { model: loadTranscriptionModel() },
  } as unknown as { param: { id: string } });
  const data = await res.json();
  if (!res.ok || "error" in data) {
    throw new Error("error" in data ? data.error : `Transcription failed (${res.status})`);
  }
}

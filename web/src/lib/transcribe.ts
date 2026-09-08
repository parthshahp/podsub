import { api } from "../api";

/**
 * Enqueue a transcription job for an episode (202 once registered).
 * Throws with a human-readable message on failure — callers keep their own
 * pending/error UI state around this.
 */
export async function requestTranscription(episodeId: string): Promise<void> {
  const res = await api.api.episodes[":id"].transcribe.$post({ param: { id: episodeId } });
  const data = await res.json();
  if (!res.ok || "error" in data) {
    throw new Error("error" in data ? data.error : `Transcription failed (${res.status})`);
  }
}

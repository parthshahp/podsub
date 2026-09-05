// Clips are sliced server-side (GET /api/episodes/:id/clip) so the browser
// never downloads or decodes the full episode. The same-origin URL
// (/api/episodes/:id/audio) also serves the <audio> element.

/** Silence kept after the last spoken word so clips don't end abruptly. */
export const TAIL_SEC = 0.3;

/** Same-origin URL for an episode's audio. Point the <audio> element here. */
export function episodeAudioUrl(episodeId: string): string {
  return `/api/episodes/${episodeId}/audio`;
}

/** Same-origin URL for an [startSec, endSec) MP3 clip of an episode. */
export function episodeClipUrl(episodeId: string, startSec: number, endSec: number): string {
  const params = new URLSearchParams({ start: String(startSec), end: String(endSec) });
  return `/api/episodes/${episodeId}/clip?${params}`;
}

/** Fetch the [startSec, endSec) clip for an episode as MP3. */
export async function loadAudioClip(
  episodeId: string,
  startSec: number,
  endSec: number,
): Promise<Blob> {
  const res = await fetch(episodeClipUrl(episodeId, startSec, endSec));
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // Non-JSON error body.
    }
    throw new Error(`Audio clip failed (${detail})`);
  }
  return await res.blob();
}

/** Base64 for an AnkiConnect `data` payload, chunked to avoid arg limits. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

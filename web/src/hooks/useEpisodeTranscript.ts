import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import type { EpisodeDetail, Transcript } from "../types";

/** Loader result for the player route: episode detail plus the transcript once loaded. */
export type EpisodeLoaderData = EpisodeDetail & { transcript: Transcript | null };

/**
 * Transcript lifecycle for the player route: polls episode status while no
 * transcript exists and merges refreshes into state.
 */
export function useEpisodeTranscript(initial: EpisodeLoaderData) {
  const [state, setState] = useState(initial);
  useEffect(() => setState(initial), [initial]);
  const { episode, transcript } = state;
  const [postError, setPostError] = useState<string | null>(null);
  // Disabled while in flight so double-clicks can't submit duplicate jobs.
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (transcript) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await api.api.episodes[":id"].$get({ param: { id: episode.id } });
        const data = await res.json();
        if (cancelled || "error" in data) return;
        if (!data.hasTranscript) {
          setState((prev) => ({ ...prev, ...data }));
          return;
        }
        const tRes = await api.api.episodes[":id"].transcript.$get({ param: { id: episode.id } });
        const tData = await tRes.json();
        if (cancelled || "error" in tData) return;
        setState((prev) => ({ ...prev, ...data, transcript: tData }));
      } catch {
        // Transient network error — next tick retries.
      }
    };
    const timer = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [transcript, episode.id]);

  // POST returns 202 once registered; polling drives the UI from there.
  const downloadTranscript = useCallback(async () => {
    setPostError(null);
    setStarting(true);
    try {
      const res = await api.api.episodes[":id"].transcribe.$post({ param: { id: episode.id } });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("error" in data ? data.error : "Failed to start transcription");
      }
      setState((prev) => ({
        ...prev,
        transcribeStatus: "running" as const,
        transcribeError: null,
      }));
    } catch (err) {
      setPostError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }, [episode.id]);

  return { state, postError, starting, downloadTranscript };
}

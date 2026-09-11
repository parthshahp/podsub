import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { requestTranscription } from "../lib/transcribe";
import type { EpisodeDetail, Transcript } from "../types";

/** Loader result for the player route: episode detail plus the transcript once loaded. */
export type EpisodeLoaderData = EpisodeDetail & { transcript: Transcript | null };

/**
 * Transcript lifecycle for the player route: polls episode status while a job
 * is queued/running and merges refreshes into state.
 */
export function useEpisodeTranscript(initial: EpisodeLoaderData) {
  const [state, setState] = useState(initial);
  // Same-route param changes reuse this component, so state is re-seeded by
  // hand when the loader hands over a *different* episode. Comparing ids rather
  // than the payload matters: the router also reloads a matched route in the
  // background (cached/preloaded data never counts as fresh), and every run
  // installs a brand-new loader payload — so a reset keyed on the payload wipes
  // the optimistic state below (a just-started transcription, the transcript
  // already polled). Post-mount freshness is the polling effect's job.
  // Re-seeding during render (React replays it before committing) keeps the
  // previous episode's data from ever painting.
  if (state.episode.id !== initial.episode.id) {
    setState(initial);
  }
  const { episode, transcript, transcribeStatus } = state;
  const [postError, setPostError] = useState<string | null>(null);
  // Disabled while in flight so double-clicks can't submit duplicate jobs.
  const [starting, setStarting] = useState(false);
  // Only queued/running can finish on their own. Polling in the terminal
  // states (idle = no job, failed = error already surfaced) would tick
  // forever without ever changing the UI; those fall back to the manual
  // "Download transcript now" button in TranscriptEmptyState.
  const transcribing = transcribeStatus === "queued" || transcribeStatus === "running";

  useEffect(() => {
    if (transcript || !transcribing) return;
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
  }, [transcript, transcribing, episode.id]);

  // POST returns 202 once registered; polling drives the UI from there.
  const downloadTranscript = useCallback(async () => {
    setPostError(null);
    setStarting(true);
    try {
      await requestTranscription(episode.id);
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

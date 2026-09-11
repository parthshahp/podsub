import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { api } from "../api";
import PageShell, { pageLoadState } from "../components/PageShell";
import { EpisodeSidebar } from "../components/player/EpisodeSidebar";
import { PlayerBar } from "../components/player/PlayerBar";
import { TranscriptEmptyState } from "../components/player/TranscriptEmptyState";
import { TranscriptSection } from "../components/player/TranscriptSection";
import { useAnkiExport } from "../hooks/useAnkiExport";
import { useEpisodeTranscript } from "../hooks/useEpisodeTranscript";
import { usePlaybackProgress } from "../hooks/usePlaybackProgress";
import { usePlayer } from "../hooks/usePlayer";
import { kebabCase } from "../lib/kebab";

export const Route = createFileRoute("/player/$episodeId")({
  loader: async ({ params: { episodeId } }) => {
    const res = await api.api.episodes[":id"].$get({ param: { id: episodeId } });
    const data = await res.json();
    if ("error" in data) throw new Error(data.error);

    // No transcript yet — a normal state, not a page error; the component
    // polls and shows progress/download based on transcribeStatus.
    if (!data.hasTranscript) return { ...data, transcript: null };

    const tRes = await api.api.episodes[":id"].transcript.$get({ param: { id: episodeId } });
    const tData = await tRes.json();
    if ("error" in tData) throw new Error(tData.error);
    return { ...data, transcript: tData };
  },
  ...pageLoadState("episode"),
  component: EpisodePage,
});

function EpisodePage() {
  // The loader result is the starting point; the hook polls until a
  // transcript exists.
  const initial = Route.useLoaderData();
  const { state, postError, starting, downloadTranscript } = useEpisodeTranscript(initial);
  const { podcast, episode, transcript, transcribeStatus, transcribeError } = state;
  const slug = kebabCase(podcast.title);
  const { audioElement, audioRef, current, duration, togglePlay, seek, subscribeToTime, getTime } =
    usePlayer();
  const playing = current?.id === episode.id;

  // Persist resume position server-side; `ended` auto-archives (= played).
  usePlaybackProgress({ episode, playing, duration, audioRef, subscribeToTime, getTime });

  // Memoized so TranscriptLine's memo() holds across playback ticks.
  const lines = useMemo(() => transcript?.lines ?? [], [transcript]);
  const words = useMemo(() => transcript?.words ?? [], [transcript]);
  const max = duration || episode.durationSec || 0;

  const anki = useAnkiExport({ podcast, episode, slug, lines, words });

  // Registered by TranscriptSection; bar seeks resume auto-follow through it.
  const resumeFollowRef = useRef<(() => void) | null>(null);

  // Stable callbacks so the memoized bar/section never invalidate.
  const handleToggle = useCallback(() => {
    togglePlay(episode);
  }, [togglePlay, episode]);

  const handleSeek = useCallback(
    (t: number) => {
      seek(t);
      resumeFollowRef.current?.();
    },
    [seek],
  );

  const handleSync = useCallback(() => {
    void anki.syncAnki();
  }, [anki.syncAnki]);

  // Autoplay on arrival: the navigation click counts as the user gesture.
  // Keyed on the episode id rather than on `episode`, because a same-route
  // param change (a "next episode" link) reuses this component: the router
  // only remounts when `remountDeps` says so. `episode` is a fresh object on
  // every loader revalidation, so keying on it would re-run the effect and
  // pause mid-episode; keying on the id plays each episode once and — since
  // togglePlay swaps the <audio> source — stops the previous one.
  useEffect(() => {
    togglePlay(episode);
    // `episode` is read from this same render; only its id is the trigger.
  }, [episode.id, togglePlay]);

  // Stacked on narrow screens (compact header → transcript → player bar)
  // so the transcript and player bar stay reachable one-handed; the
  // viewport-locked column keeps the player bar visible without scrolling.
  //
  // Render isolation: this page never subscribes to playback time or hover.
  // PlayerBar subscribes to the raw time (ticks alone); TranscriptSection
  // subscribes to the derived active-line index (re-renders only when the
  // highlighted line changes) and owns hover/dialog state. Playback and
  // hover therefore never re-render this page, the sidebar, or each other.
  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col overflow-hidden">
      {audioElement}
      <PageShell className="flex min-h-0 flex-1 flex-col md:flex-row">
        <EpisodeSidebar podcast={podcast} episode={episode} slug={slug} />

        {transcript ? (
          <TranscriptSection
            episode={episode}
            lines={lines}
            togglePlay={togglePlay}
            seek={seek}
            subscribeToTime={subscribeToTime}
            getTime={getTime}
            ankiStatus={anki.status}
            ankiConnected={anki.ankiConnected}
            sendingWord={anki.sendingWord}
            exportWord={anki.exportWord}
            resumeFollowRef={resumeFollowRef}
          />
        ) : (
          <TranscriptEmptyState
            transcribeStatus={transcribeStatus}
            transcribeError={transcribeError}
            postError={postError}
            starting={starting}
            onDownload={() => void downloadTranscript()}
          />
        )}
      </PageShell>

      <PlayerBar
        episode={episode}
        playing={playing}
        max={max}
        ankiConnected={anki.ankiConnected}
        syncing={anki.syncing}
        subscribeToTime={subscribeToTime}
        getTime={getTime}
        onToggle={handleToggle}
        onSeek={handleSeek}
        onSync={handleSync}
      />
    </div>
  );
}

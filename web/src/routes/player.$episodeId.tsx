import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { api } from "../api";
import { DefinitionPopover } from "../components/DefinitionPopover";
import { EpisodeSidebar } from "../components/player/EpisodeSidebar";
import { PlayerBar } from "../components/player/PlayerBar";
import { TranscriptEmptyState } from "../components/player/TranscriptEmptyState";
import { TranscriptPane } from "../components/player/TranscriptPane";
import { useAnkiExport } from "../hooks/useAnkiExport";
import { useEpisodeTranscript } from "../hooks/useEpisodeTranscript";
import { usePlaybackShortcuts } from "../hooks/usePlaybackShortcuts";
import { usePlayer } from "../hooks/usePlayer";
import { useTranscriptFollow } from "../hooks/useTranscriptFollow";
import { useWordHover } from "../hooks/useWordHover";
import { kebabCase } from "../lib/kebab";
import { findActiveLineIndex } from "../lib/transcriptView";

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
  pendingComponent: () => (
    <main id="main-content" tabIndex={-1} className="p-6">
      <p className="text-sm text-base-content/60">Loading episode…</p>
    </main>
  ),
  errorComponent: ({ error }) => (
    <main id="main-content" tabIndex={-1} className="p-6">
      <p className="text-sm text-error">Failed to load episode: {error.message}</p>
    </main>
  ),
  component: EpisodePage,
});

function EpisodePage() {
  // The loader result is the starting point; the hook polls until a
  // transcript exists.
  const initial = Route.useLoaderData();
  const { state, postError, starting, downloadTranscript } = useEpisodeTranscript(initial);
  const { podcast, episode, transcript, transcribeStatus, transcribeError } = state;
  const slug = kebabCase(podcast.title);
  const { audioElement, current, currentTime, duration, togglePlay, seek } = usePlayer();
  const playing = current?.id === episode.id;

  // Memoized so TranscriptLine's memo() holds across playback ticks.
  const lines = useMemo(() => transcript?.lines ?? [], [transcript]);
  const words = useMemo(() => transcript?.words ?? [], [transcript]);
  const max = duration || episode.durationSec || 0;

  // -1 when nothing is active.
  const activeIdx = findActiveLineIndex(lines, currentTime);

  const { containerRef, follow, setFollow, handleUserScroll } = useTranscriptFollow(activeIdx);
  const anki = useAnkiExport({ podcast, episode, slug, lines, words });
  const {
    hoveredWord,
    dialogWord,
    dialogKey,
    handleWordEnter,
    handleWordLeave,
    hideHoveredWord,
    keepHover,
    openWord,
    closeDialog,
  } = useWordHover();
  // Activated dialog takes precedence over the hover preview.
  const activeWord = dialogWord ?? hoveredWord;

  const startedRef = useRef(false);

  // Stable per-row callback so TranscriptLine's memo() isn't defeated.
  const handleSeekLine = useCallback(
    (start: number) => {
      seek(start);
      setFollow(true);
    },
    [seek, setFollow],
  );

  // Autoplay on arrival: the navigation click counts as the user gesture.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    togglePlay(episode);
  }, [episode, togglePlay]);

  usePlaybackShortcuts({ episode, lines, activeIdx, togglePlay, seek, setFollow });

  // Stacked on narrow screens (compact header → transcript → player bar)
  // so the transcript and player bar stay reachable one-handed; the
  // viewport-locked column keeps the player bar visible without scrolling.
  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col">
      {audioElement}
      <main id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col md:flex-row">
        <EpisodeSidebar podcast={podcast} episode={episode} slug={slug} />

        {transcript ? (
          <div className="relative min-w-0 flex-1">
            <TranscriptPane
              lines={lines}
              activeIdx={activeIdx}
              exporting={anki.exporting}
              follow={follow}
              dialogKey={dialogKey}
              containerRef={containerRef}
              onSeekLine={handleSeekLine}
              onExportLine={anki.handleExportLine}
              onWordEnter={handleWordEnter}
              onWordLeave={handleWordLeave}
              onWordActivate={openWord}
              onUserScroll={handleUserScroll}
              onScrollHide={hideHoveredWord}
              onResumeFollow={() => setFollow(true)}
            />
            {activeWord && (
              <DefinitionPopover
                hover={activeWord}
                dialog={dialogWord != null}
                focusOnOpen={dialogWord != null}
                invoker={dialogWord?.invoker}
                onClose={() => {
                  if (dialogWord) closeDialog();
                  else hideHoveredWord();
                }}
                onKeep={keepHover}
                onLeave={handleWordLeave}
                onAnki={
                  anki.ankiConnected
                    ? (sel) => {
                        void anki.exportWord(sel).then((added) => {
                          if (added) {
                            if (dialogWord) closeDialog();
                            else hideHoveredWord();
                          }
                        });
                      }
                    : undefined
                }
                ankiSending={anki.sendingWord === activeWord.word}
              />
            )}
            {anki.status && (
              <div
                role="status"
                className={`alert absolute right-6 bottom-6 z-10 w-auto max-w-md py-2 text-sm shadow-lg ${
                  anki.status.kind === "success" ? "alert-success" : "alert-error"
                }`}
              >
                {anki.status.message}
              </div>
            )}
          </div>
        ) : (
          <TranscriptEmptyState
            transcribeStatus={transcribeStatus}
            transcribeError={transcribeError}
            postError={postError}
            starting={starting}
            onDownload={() => void downloadTranscript()}
          />
        )}
      </main>

      <PlayerBar
        episode={episode}
        playing={playing}
        currentTime={currentTime}
        max={max}
        ankiConnected={anki.ankiConnected}
        syncing={anki.syncing}
        onToggle={() => togglePlay(episode)}
        onSeek={(t) => {
          seek(t);
          setFollow(true);
        }}
        onSync={() => void anki.syncAnki()}
      />
    </div>
  );
}

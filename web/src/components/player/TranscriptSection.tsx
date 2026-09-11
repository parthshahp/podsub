import { memo, useCallback, useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

import { usePlaybackShortcuts } from "../../hooks/usePlaybackShortcuts";
import { useTranscriptFollow } from "../../hooks/useTranscriptFollow";
import { useWordHover } from "../../hooks/useWordHover";
import type { ExportStatus, WordSelection } from "../../hooks/useAnkiExport";
import { prefetchDictionary } from "../../lib/dictionary";
import { findActiveLineIndex, type TranscriptLineData } from "../../lib/transcriptView";
import type { Episode } from "../../types";
import type { WordHoverInfo } from "../WordSpans";
import { DefinitionPopover } from "../DefinitionPopover";
import { TranscriptPane } from "./TranscriptPane";

type TranscriptSectionProps = {
  episode: Episode;
  lines: TranscriptLineData[];
  togglePlay: (e: Episode) => void;
  seek: (t: number) => void;
  subscribeToTime: (cb: () => void) => () => void;
  getTime: () => number;
  ankiStatus: ExportStatus | null;
  ankiConnected: boolean;
  sendingWord: string | null;
  exportWord: (sel: WordSelection) => Promise<boolean>;
  /**
   * Follow lives in this section, but the PlayerBar (a sibling) also seeks.
   * The page wires bar seeks through this ref so dragging the slider
   * resumes auto-follow without lifting follow state (and its renders)
   * back up to the page.
   */
  resumeFollowRef: RefObject<(() => void) | null>;
};

/**
 * Transcript subtree: owns everything that updates during playback or hover
 * (active line, auto-follow, hover preview, dialog) so those states never
 * re-render the page, sidebar, or player bar.
 *
 * - activeIdx derives from the shared time store via useSyncExternalStore:
 *   the snapshot is a line number, so this section re-renders only when the
 *   highlighted line actually changes — not on every ~4Hz tick.
 * - hover/dialog state lives here too: hovering a word re-renders only this
 *   section (pane memo bails for rows, popover updates), never the page.
 */
export const TranscriptSection = memo(function TranscriptSection({
  episode,
  lines,
  togglePlay,
  seek,
  subscribeToTime,
  getTime,
  ankiStatus,
  ankiConnected,
  sendingWord,
  exportWord,
  resumeFollowRef,
}: TranscriptSectionProps) {
  // Snapshot is the line index (a stable number) — Object.is bails out on
  // the vast majority of time notifications.
  const activeIdx = useSyncExternalStore(
    subscribeToTime,
    () => findActiveLineIndex(lines, getTime()),
  );

  const { containerRef, follow, setFollow, handleUserScroll, handleScrollDivert } =
    useTranscriptFollow(activeIdx);

  // Let sibling seeks (player bar slider, shortcuts elsewhere) resume follow.
  useEffect(() => {
    resumeFollowRef.current = () => setFollow(true);
    return () => {
      resumeFollowRef.current = null;
    };
  }, [setFollow, resumeFollowRef]);

  // Words are hoverable as soon as this section mounts, so start the 13 MB
  // dictionary download now (on idle) rather than on the first hover. The
  // prefetch is cancellable: navigating away before it starts skips it.
  useEffect(() => prefetchDictionary(), []);

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
    refreshDialogRect,
  } = useWordHover();
  // Activated dialog takes precedence over the hover preview.
  const activeWord = dialogWord ?? hoveredWord;

  usePlaybackShortcuts({ episode, lines, activeIdx, togglePlay, seek, setFollow });

  // Ref mirror of lines for the delegated word handlers below — reading
  // the ref keeps those three callbacks stable forever instead of
  // re-creating them (and invalidating the pane memo) per render.
  const linesRef = useRef(lines);
  linesRef.current = lines;

  /** Nearest word button for an event target, if the event hit one. */
  const wordButtonFrom = (target: EventTarget | null): HTMLElement | null =>
    target instanceof HTMLElement ? target.closest("[data-word-btn]") : null;

  const wordInfoFrom = (btn: HTMLElement): WordHoverInfo => {
    const lineIndex = Number(btn.dataset.lineIndex);
    return {
      word: btn.dataset.word ?? "",
      lineText: linesRef.current[lineIndex]?.text ?? "",
      start: Number(btn.dataset.start),
      lineIndex,
      el: btn,
    };
  };

  // mouseover/out bubble (unlike mouseenter/leave), so one pair on the
  // <ol> covers all ~5k words. relatedTarget checks give enter/leave
  // semantics: moves within the same button are ignored.
  const handleWordOver = useCallback(
    (e: React.MouseEvent<HTMLOListElement>) => {
      const to = wordButtonFrom(e.target);
      if (!to) return;
      const from =
        e.relatedTarget instanceof HTMLElement
          ? e.relatedTarget.closest("[data-word-btn]")
          : null;
      if (from === to) return;
      handleWordEnter(wordInfoFrom(to));
    },
    [handleWordEnter],
  );

  const handleWordOut = useCallback(
    (e: React.MouseEvent<HTMLOListElement>) => {
      const from = wordButtonFrom(e.target);
      if (!from) return;
      const to =
        e.relatedTarget instanceof HTMLElement
          ? e.relatedTarget.closest("[data-word-btn]")
          : null;
      if (to === from) return;
      handleWordLeave();
    },
    [handleWordLeave],
  );

  // Clicks bubble from word buttons (open the dialog) and rows (seek);
  // the row's own handler ignores clicks inside buttons, so no conflict.
  const handleWordClick = useCallback(
    (e: React.MouseEvent<HTMLOListElement>) => {
      const btn = wordButtonFrom(e.target);
      if (!btn) return;
      openWord(wordInfoFrom(btn));
    },
    [openWord],
  );

  // Stable per-row callback so TranscriptLine's memo() isn't defeated.
  const handleSeekLine = useCallback(
    (start: number) => {
      seek(start);
      setFollow(true);
    },
    [seek, setFollow],
  );

  // The dialog captures its word's rect at open time — keep it anchored
  // when the pane scrolls and pause auto-follow while open so playback
  // doesn't scroll the line away from under the popover. The same handler
  // diverts follow for scrolls we didn't cause ourselves (a scrollbar drag
  // fires `scroll` but never `wheel`).
  const handlePaneScroll = useCallback(() => {
    hideHoveredWord();
    refreshDialogRect();
    handleScrollDivert();
  }, [hideHoveredWord, refreshDialogRect, handleScrollDivert]);

  const handleResumeFollow = useCallback(() => {
    setFollow(true);
  }, [setFollow]);

  useEffect(() => {
    if (dialogWord) setFollow(false);
  }, [dialogWord, setFollow]);

  // Stable popover callbacks — inline arrows here would re-render the
  // popover on every active-line change.
  const handlePopoverClose = useCallback(() => {
    if (dialogWord) closeDialog();
    else hideHoveredWord();
  }, [dialogWord, closeDialog, hideHoveredWord]);

  const handleExportWord = useCallback(
    (sel: WordSelection) => {
      void exportWord(sel).then((added) => {
        if (added) {
          if (dialogWord) closeDialog();
          else hideHoveredWord();
        }
      });
    },
    [exportWord, dialogWord, closeDialog, hideHoveredWord],
  );

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <TranscriptPane
        lines={lines}
        activeIdx={activeIdx}
        follow={follow}
        dialogKey={dialogKey}
        containerRef={containerRef}
        onSeekLine={handleSeekLine}
        onWordOver={handleWordOver}
        onWordOut={handleWordOut}
        onWordClick={handleWordClick}
        onUserScroll={handleUserScroll}
        onScroll={handlePaneScroll}
        onResumeFollow={handleResumeFollow}
      />
      {activeWord && (
        <DefinitionPopover
          hover={activeWord}
          dialog={dialogWord != null}
          focusOnOpen={dialogWord != null}
          invoker={dialogWord?.invoker}
          onClose={handlePopoverClose}
          onKeep={keepHover}
          onLeave={handleWordLeave}
          onAnki={ankiConnected ? handleExportWord : undefined}
          ankiSending={sendingWord === activeWord.word}
        />
      )}
      {ankiStatus && (
        <div
          role="status"
          className={`alert absolute right-4 bottom-16 z-10 w-auto max-w-md py-2 text-sm shadow-lg sm:right-6 sm:bottom-6 ${
            ankiStatus.kind === "success" ? "alert-success" : "alert-error"
          }`}
        >
          {ankiStatus.message}
        </div>
      )}
    </div>
  );
});

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { addNotes, getVersion, syncAnkiWeb, type AnkiNote } from "../lib/anki";
import { buildCardData, buildNote, isConfigured } from "../lib/ankiExport";
import { loadAnkiSettings } from "../lib/ankiSettings";
import { blobToBase64, loadAudioClip } from "../lib/audioClip";
import { lineEndSec, loadPodcastImage, type TranscriptLineData } from "../lib/transcriptView";
import type { Episode, Podcast, Word } from "../types";

export type ExportStatus = { kind: "success" | "error"; message: ReactNode };

/** Hovered word plus the dictionary data for its word card. */
export type WordSelection = {
  word: string;
  pinyin: string;
  definition: string;
  lineIndex: number;
};

type UseAnkiExportArgs = {
  podcast: Podcast;
  episode: Episode;
  slug: string;
  lines: TranscriptLineData[];
  words: Word[];
};

/** Anki export via AnkiConnect plus the transient status toast. */
export function useAnkiExport({ podcast, episode, slug, lines, words }: UseAnkiExportArgs) {
  const [status, setStatus] = useState<ExportStatus | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ankiConnected, setAnkiConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** Headword of the word card currently being exported, if any. */
  const [sendingWord, setSendingWord] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    },
    [],
  );

  // Probed once on mount so the sync button only shows when Anki is reachable.
  useEffect(() => {
    const settings = loadAnkiSettings();
    if (!isConfigured(settings)) return;
    let cancelled = false;
    getVersion(settings.url)
      .then(() => {
        if (!cancelled) setAnkiConnected(true);
      })
      .catch(() => {
        // Anki not running — sync button stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showStatus = useCallback((kind: "success" | "error", message: ReactNode) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatus({ kind, message });
    statusTimerRef.current = setTimeout(() => setStatus(null), 5000);
  }, []);

  const showUnconfigured = useCallback(() => {
    showStatus(
      "error",
      <>
        Anki export isn’t configured.{" "}
        <Link to="/settings" className="link">
          Open settings
        </Link>
        .
      </>,
    );
  }, [showStatus]);

  /** Sync the Anki collection with AnkiWeb via AnkiConnect. */
  const syncAnki = useCallback(async () => {
    const settings = loadAnkiSettings();
    if (!isConfigured(settings)) return;
    setSyncing(true);
    try {
      await syncAnkiWeb(settings.url);
      showStatus("success", "Anki collection synced");
    } catch (err) {
      showStatus("error", err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, [showStatus]);

  /** Send the given transcript lines to Anki as notes via AnkiConnect. */
  const exportLines = useCallback(
    async (indices: number[]) => {
      const settings = loadAnkiSettings();
      if (!isConfigured(settings)) {
        showUnconfigured();
        return;
      }
      // Only fetch media that's actually mapped to a field.
      const includeAudio = Object.values(settings.mappings).includes("audio");
      setExporting(true);
      try {
        // Each clip is one small server-side slice, so timing stays flat.
        const audioT0 = performance.now();
        const notes: AnkiNote[] = [];
        for (const i of indices) {
          const filename = includeAudio
            ? `${slug}-${episode.id}-${lines[i].start.toFixed(2)}.mp3`
            : undefined;
          const note = buildNote(
            settings,
            buildCardData({
              lineText: lines[i].text,
              lineStart: lines[i].start,
              podcastTitle: podcast.title,
              episodeTitle: episode.title,
              audio: filename && `[sound:${filename}]`,
            }),
          );
          if (filename) {
            const clip = await loadAudioClip(
              episode.id,
              lines[i].start,
              lineEndSec(i, lines, words),
            );
            note.audio = [{ data: await blobToBase64(clip), filename }];
          }
          notes.push(note);
        }
        const audioSecs = (performance.now() - audioT0) / 1000;
        const audioInfo = includeAudio
          ? ` · audio prepared in ${
              audioSecs < 1 ? `${Math.round(audioSecs * 1000)} ms` : `${audioSecs.toFixed(1)} s`
            }`
          : "";
        const results = await addNotes(settings.url, notes);
        const added = results.filter((r) => r !== null).length;
        const skipped = results.length - added;
        const noun = `card${added === 1 ? "" : "s"}`;
        if (added === 0) {
          showStatus(
            "error",
            skipped === 1
              ? `Card not added — it may already exist in your collection, or its first field is empty.${audioInfo}`
              : `No cards added — ${skipped} skipped (duplicates, or empty first field).${audioInfo}`,
          );
        } else {
          showStatus(
            "success",
            skipped > 0
              ? `${added} ${noun} sent · ${skipped} skipped (already in collection?)${audioInfo}`
              : `${added} ${noun} sent to Anki${audioInfo}`,
          );
        }
      } catch (err) {
        showStatus("error", err instanceof Error ? err.message : String(err));
      } finally {
        setExporting(false);
      }
    },
    [episode.id, episode.title, lines, words, podcast.title, slug, showStatus, showUnconfigured],
  );

  /** Send the hovered word's card to Anki; resolves true when added. */
  const exportWord = useCallback(
    async (sel: WordSelection): Promise<boolean> => {
      const settings = loadAnkiSettings();
      if (!isConfigured(settings)) {
        showUnconfigured();
        return false;
      }
      const i = sel.lineIndex;
      const line = lines[i];
      if (!line) return false;

      // Only fetch media that's actually mapped to a field.
      const mappings = Object.values(settings.mappings);
      const includeAudio = mappings.includes("audio");
      const includeImage = mappings.includes("image") && podcast.imageUrl != null;
      setSendingWord(sel.word);
      try {
        // Each clip is one small server-side slice, so timing stays flat.
        const mediaT0 = performance.now();
        const [image, clip] = await Promise.all([
          includeImage ? loadPodcastImage(podcast.id) : Promise.resolve(null),
          includeAudio
            ? loadAudioClip(episode.id, line.start, lineEndSec(i, lines, words))
            : Promise.resolve(null),
        ]);
        const audioFilename = includeAudio
          ? `${slug}-${episode.id}-${line.start.toFixed(2)}.mp3`
          : undefined;
        const imageFilename = image ? `podsub-${podcast.id}.${image.ext}` : undefined;

        const note = buildNote(
          settings,
          buildCardData({
            lineText: line.text,
            lineStart: line.start,
            podcastTitle: podcast.title,
            episodeTitle: episode.title,
            audio: audioFilename && `[sound:${audioFilename}]`,
            word: sel.word,
            pinyin: sel.pinyin,
            definition: sel.definition,
            image: imageFilename && `<img src="${imageFilename}">`,
          }),
        );
        if (clip && audioFilename) {
          note.audio = [{ data: await blobToBase64(clip), filename: audioFilename }];
        }
        if (image && imageFilename) {
          note.picture = [{ data: image.base64, filename: imageFilename }];
        }
        const mediaSecs = (performance.now() - mediaT0) / 1000;
        const mediaInfo =
          includeAudio || includeImage
            ? ` · media prepared in ${
                mediaSecs < 1 ? `${Math.round(mediaSecs * 1000)} ms` : `${mediaSecs.toFixed(1)} s`
              }`
            : "";

        const results = await addNotes(settings.url, [note]);
        if (results[0] === null) {
          showStatus(
            "error",
            `Card not added — it may already exist in your collection, or its first field is empty.${mediaInfo}`,
          );
          return false;
        }
        showStatus("success", `“${sel.word}” sent to Anki${mediaInfo}`);
        return true;
      } catch (err) {
        showStatus("error", err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setSendingWord(null);
      }
    },
    [
      episode.id,
      episode.title,
      lines,
      words,
      podcast.id,
      podcast.imageUrl,
      podcast.title,
      slug,
      showStatus,
      showUnconfigured,
    ],
  );

  // Route through a ref so the row callback stays stable across renders.
  const exportLinesRef = useRef(exportLines);
  exportLinesRef.current = exportLines;
  const handleExportLine = useCallback((index: number) => {
    void exportLinesRef.current([index]);
  }, []);

  return {
    status,
    ankiConnected,
    syncing,
    exporting,
    sendingWord,
    syncAnki,
    exportLines,
    exportWord,
    handleExportLine,
  };
}

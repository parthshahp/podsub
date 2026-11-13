import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api";
import { requestTranscription } from "../lib/transcribe";
import type { EpisodeListItem } from "../types";

const PAGE_SIZE = 50;

export type EpisodeListPage = { episodes: EpisodeListItem[]; total: number };
export type PodcastFilter = { mode: "include" | "exclude"; ids: string[] };

type Options = {
  /** Loader-provided first page (active episodes, no search). */
  initial: EpisodeListPage;
  /** Optional podcast scope; omit to list episodes across all podcasts. */
  podcastId?: string;
};

type PageRequest = {
  limit: number;
  offset: number;
  q: string;
  includeArchived: boolean;
  hasTranscriptOnly: boolean;
  inProgressOnly: boolean;
};

/** Shared state machine behind the podcast and all-episodes pages: debounced
 * server-side search, filter toggles, load-more pagination, and optimistic
 * archive / transcript actions, all against GET /api/episodes. */
export function useEpisodeList({ initial, podcastId }: Options) {
  // Server-side search: immediate input value plus the debounced API value.
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const trimmedSearch = debouncedQuery.trim();
  const isSearching = trimmedSearch !== "";

  // Whether archived episodes are included in the list (hidden by default).
  const [showArchived, setShowArchived] = useState(false);
  // When true, only episodes that already have a transcript are listed.
  const [hasTranscriptOnly, setHasTranscriptOnly] = useState(false);
  // When true, only in-progress episodes (saved position >= 5s) are listed.
  const [inProgressOnly, setInProgressOnly] = useState(false);
  const [podcastFilter, setPodcastFilter] = useState<PodcastFilter>({ mode: "include", ids: [] });
  // Fresh page-0 + total after the archived toggle changes; null means the
  // loader's first page is still current.
  const [page0, setPage0] = useState<EpisodeListPage | null>(null);
  const [extraPages, setExtraPages] = useState<EpisodeListItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [archivePendingId, setArchivePendingId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveUndo, setArchiveUndo] = useState<EpisodeListItem | null>(null);
  const [undoingArchive, setUndoingArchive] = useState(false);
  const archiveBusyRef = useRef(false);
  const [archiveRevision, setArchiveRevision] = useState(0);
  const undoRefreshSizes = useRef<{ browse: number | null; search: number | null }>({
    browse: null,
    search: null,
  });
  const [transcriptPendingId, setTranscriptPendingId] = useState<string | null>(null);
  // Episodes queued for transcription this session (optimistic). The list
  // also carries the server queue state per episode (transcribeStatus), so
  // queued jobs survive reloads; this set covers the gap before refetch.
  const [transcriptStartedIds, setTranscriptStartedIds] = useState<Set<string>>(new Set());
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  // Search results replace the paged browse list.
  const [searchPage, setSearchPage] = useState<EpisodeListPage>({ episodes: [], total: 0 });
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchKey = JSON.stringify([
    podcastId,
    trimmedSearch,
    showArchived,
    hasTranscriptOnly,
    inProgressOnly,
    podcastFilter,
    archiveRevision,
  ]);
  const [settledSearchKey, setSettledSearchKey] = useState<string | null>(null);
  // Derive pending state from request identity so even the render before the
  // effect starts cannot show an empty result as a completed search.
  const searching = query !== debouncedQuery || (isSearching && settledSearchKey !== searchKey);

  const fetchPage = useCallback(
    async ({
      limit,
      offset,
      q,
      includeArchived,
      hasTranscriptOnly,
      inProgressOnly,
    }: PageRequest): Promise<EpisodeListPage> => {
      const res = await api.api.episodes.$get({
        query: {
          limit: String(limit),
          offset: String(offset),
          ...(q !== "" ? { q } : {}),
          ...(includeArchived ? { includeArchived: "true" } : {}),
          ...(hasTranscriptOnly ? { hasTranscriptOnly: "true" } : {}),
          ...(inProgressOnly ? { inProgressOnly: "true" } : {}),
          ...(podcastId !== undefined ? { podcastId } : {}),
          ...(podcastFilter.ids.length > 0
            ? {
                [podcastFilter.mode === "include" ? "includePodcastIds" : "excludePodcastIds"]:
                  podcastFilter.ids.join(","),
              }
            : {}),
        },
      });
      const data = await res.json();
      if ("error" in data) throw new Error(data.error);
      return { episodes: data.episodes, total: data.total };
    },
    [podcastId, podcastFilter],
  );

  // Undo refreshes all loaded pages, not just page 0, so recovering a row
  // deep in the list doesn't discard pagination or jump back to the top.
  const fetchPages = useCallback(
    async (
      options: Omit<PageRequest, "limit" | "offset">,
      count = PAGE_SIZE,
    ): Promise<EpisodeListPage> => {
      const pages = await Promise.all(
        Array.from({ length: Math.max(1, Math.ceil(count / PAGE_SIZE)) }, (_, index) =>
          fetchPage({ ...options, limit: PAGE_SIZE, offset: index * PAGE_SIZE }),
        ),
      );
      return { episodes: pages.flatMap((page) => page.episodes), total: pages[0]!.total };
    },
    [fetchPage],
  );

  // Reset pagination when the scope or search changes.
  useEffect(() => {
    setExtraPages([]);
    setLoadError(null);
    setSearchError(null);
    setArchiveError(null);
  }, [podcastId, trimmedSearch]);

  // A new scope means the loader fetched a fresh first page again.
  useEffect(() => {
    setPage0(null);
    setShowArchived(false);
    setHasTranscriptOnly(false);
    setInProgressOnly(false);
    setTranscriptStartedIds(new Set());
    setTranscriptError(null);
    setArchiveUndo(null);
  }, [podcastId]);

  // Skip the refetch on first mount — the loader already fetched page 0.
  const firstRender = useRef(true);
  const pageGeneration = useRef(0);

  // Re-fetch page 0 when a filter toggle (or scope) changes, since the
  // loader only fetches the default unfiltered first page.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    let cancelled = false;
    const restoreCount = undoRefreshSizes.current.browse;
    undoRefreshSizes.current.browse = null;
    pageGeneration.current += 1;
    if (restoreCount === null) setExtraPages([]);
    setLoadingMore(false);
    setLoadError(null);
    fetchPages(
      {
        q: "",
        includeArchived: showArchived,
        hasTranscriptOnly,
        inProgressOnly,
      },
      restoreCount ?? PAGE_SIZE,
    )
      .then((page) => {
        if (!cancelled) {
          setPage0(page);
          setExtraPages([]);
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPages, showArchived, hasTranscriptOnly, inProgressOnly, archiveRevision]);

  // Fetch matching episodes (all pages, not just loaded). Archived episodes
  // are included only when the toggle is on.
  useEffect(() => {
    setSettledSearchKey(null);
    const restoreCount = undoRefreshSizes.current.search;
    undoRefreshSizes.current.search = null;
    if (!isSearching) return;
    let cancelled = false;
    pageGeneration.current += 1;
    setLoadingMore(false);
    setSearchError(null);
    fetchPages(
      {
        q: trimmedSearch,
        includeArchived: showArchived,
        hasTranscriptOnly,
        inProgressOnly,
      },
      restoreCount ?? PAGE_SIZE,
    )
      .then((page) => {
        if (!cancelled) setSearchPage(page);
      })
      .catch((err) => {
        if (!cancelled) setSearchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setSettledSearchKey(searchKey);
      });
    return () => {
      cancelled = true;
    };
  }, [
    fetchPages,
    trimmedSearch,
    isSearching,
    showArchived,
    hasTranscriptOnly,
    inProgressOnly,
    searchKey,
  ]);

  const page0Episodes = page0?.episodes ?? initial.episodes;
  const page0Total = page0?.total ?? initial.total;
  const browseEpisodes = [...page0Episodes, ...extraPages];
  const episodes = isSearching ? searchPage.episodes : browseEpisodes;
  const shownTotal = isSearching ? searchPage.total : page0Total;
  const hasMore = episodes.length < shownTotal;

  async function loadMore() {
    const generation = pageGeneration.current;
    setLoadError(null);
    setLoadingMore(true);
    try {
      const page = await fetchPage({
        limit: PAGE_SIZE,
        offset: episodes.length,
        q: isSearching ? trimmedSearch : "",
        includeArchived: showArchived,
        hasTranscriptOnly,
        inProgressOnly,
      });
      if (generation !== pageGeneration.current) return;
      if (isSearching) {
        setSearchPage((prev) => ({ ...prev, episodes: [...prev.episodes, ...page.episodes] }));
      } else {
        setExtraPages((prev) => [...prev, ...page.episodes]);
      }
    } catch (err) {
      if (generation === pageGeneration.current)
        setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generation === pageGeneration.current) setLoadingMore(false);
    }
  }

  async function toggleArchive(ep: EpisodeListItem) {
    if (archiveBusyRef.current) return;
    archiveBusyRef.current = true;
    const next = !ep.archived;
    setArchivePendingId(ep.id);
    setArchiveError(null);
    // Snapshot for rollback if the request fails.
    const prevPage0 = page0;
    const prevExtra = extraPages;
    const prevSearch = searchPage;

    if (next && !showArchived) {
      // Archiving hides the row from the default list: drop it everywhere.
      // page0 falls back to the loader's first page when no refetch ran yet.
      const drop = (page: EpisodeListPage): EpisodeListPage => ({
        episodes: page.episodes.filter((x) => x.id !== ep.id),
        total: page.total - 1,
      });
      setPage0((p) => drop(p ?? initial));
      setExtraPages((prev) => prev.filter((x) => x.id !== ep.id));
      setSearchPage((p) => ({
        episodes: p.episodes.filter((x) => x.id !== ep.id),
        total: isSearching ? p.total - 1 : p.total,
      }));
    } else {
      // Archived rows stay visible (faded) while the toggle is on. Archiving
      // counts as played and clears the resume position server-side.
      const mark = (list: EpisodeListItem[]) =>
        list.map((x) => (x.id === ep.id ? { ...x, archived: next, positionSec: 0 } : x));
      setPage0((p) => {
        const base = p ?? { episodes: initial.episodes, total: initial.total };
        return { ...base, episodes: mark(base.episodes) };
      });
      setExtraPages(mark);
      setSearchPage((p) => ({ ...p, episodes: mark(p.episodes) }));
    }

    try {
      const res = await api.api.episodes[":id"].archive.$patch({
        param: { id: ep.id },
        json: { archived: next },
      });
      const data = await res.json();
      if (!res.ok || "error" in data) {
        throw new Error("error" in data ? data.error : `Archive failed (${res.status})`);
      }
      setArchiveUndo(next ? ep : null);
    } catch (err) {
      setPage0(prevPage0);
      setExtraPages(prevExtra);
      setSearchPage(prevSearch);
      setArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      archiveBusyRef.current = false;
      setArchivePendingId(null);
    }
  }

  async function undoArchive() {
    if (!archiveUndo || archiveBusyRef.current) return;
    archiveBusyRef.current = true;
    setUndoingArchive(true);
    setArchiveError(null);
    try {
      const res = await api.api.episodes[":id"].archive.$patch({
        param: { id: archiveUndo.id },
        json: { archived: false, positionSec: archiveUndo.positionSec ?? 0 },
      });
      const data = await res.json();
      if (!res.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Could not undo archive. Try again.");
      }
      setArchiveUndo(null);
      // Refetch the current filters rather than restoring a stale whole-list
      // snapshot that could overwrite other actions or a changed search.
      undoRefreshSizes.current = {
        browse: browseEpisodes.length + (showArchived ? 0 : 1),
        search: searchPage.episodes.length + (showArchived ? 0 : 1),
      };
      setArchiveRevision((revision) => revision + 1);
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : "Could not undo archive. Try again.");
    } finally {
      archiveBusyRef.current = false;
      setUndoingArchive(false);
    }
  }

  async function downloadTranscript(ep: EpisodeListItem) {
    if (
      ep.hasTranscript ||
      ep.transcribeStatus === "queued" ||
      ep.transcribeStatus === "running" ||
      transcriptStartedIds.has(ep.id) ||
      transcriptPendingId === ep.id
    ) {
      return;
    }
    setTranscriptPendingId(ep.id);
    setTranscriptError(null);
    try {
      await requestTranscription(ep.id);
      setTranscriptStartedIds((prev) => new Set(prev).add(ep.id));
      // Optimistically reflect the server queue so the icon flips to
      // in-progress immediately, even before the next list refetch.
      const markQueued = (list: EpisodeListItem[]) =>
        list.map((x) => (x.id === ep.id ? { ...x, transcribeStatus: "queued" as const } : x));
      setPage0((p) => {
        const base = p ?? { episodes: initial.episodes, total: initial.total };
        return { ...base, episodes: markQueued(base.episodes) };
      });
      setExtraPages(markQueued);
      setSearchPage((p) => ({ ...p, episodes: markQueued(p.episodes) }));
    } catch (err) {
      setTranscriptError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscriptPendingId(null);
    }
  }

  return {
    episodes,
    total: shownTotal,
    hasMore,
    query,
    setQuery,
    searching,
    showArchived,
    setShowArchived,
    hasTranscriptOnly,
    setHasTranscriptOnly,
    inProgressOnly,
    setInProgressOnly,
    podcastFilter,
    setPodcastFilter,
    loadMore,
    loadingMore,
    loadError: loadError ?? searchError ?? archiveError ?? transcriptError,
    toggleArchive,
    archivePendingId,
    archiveUndo,
    undoArchive,
    undoingArchive,
    dismissArchiveUndo: () => setArchiveUndo(null),
    downloadTranscript,
    transcriptPendingId,
    transcriptStartedIds,
  };
}

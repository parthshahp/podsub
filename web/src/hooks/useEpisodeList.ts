import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api";
import { requestTranscription } from "../lib/transcribe";
import type { EpisodeListItem } from "../types";

const PAGE_SIZE = 50;

export type EpisodeListPage = { episodes: EpisodeListItem[]; total: number };

type Options = {
  /** Loader-provided first page (active episodes, no search). */
  initial: EpisodeListPage;
  /** Optional podcast scope; omit to list episodes across all podcasts. */
  podcastId?: string;
};

/** Shared state machine behind the podcast and all-episodes pages: debounced
 * server-side search, archived toggle, load-more pagination, and optimistic
 * archive / transcript actions, all against GET /api/episodes. */
export function useEpisodeList({ initial, podcastId }: Options) {
  // Server-side search: immediate input value plus the debounced API value.
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const searching = query !== debouncedQuery;
  const trimmedSearch = debouncedQuery.trim();
  const isSearching = trimmedSearch !== "";

  // Whether archived episodes are included in the list (hidden by default).
  const [showArchived, setShowArchived] = useState(false);
  // Fresh page-0 + total after the archived toggle changes; null means the
  // loader's first page is still current.
  const [page0, setPage0] = useState<EpisodeListPage | null>(null);
  const [extraPages, setExtraPages] = useState<EpisodeListItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [archivePendingId, setArchivePendingId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [transcriptPendingId, setTranscriptPendingId] = useState<string | null>(null);
  // Episodes queued for transcription this session (optimistic). The list
  // also carries the server queue state per episode (transcribeStatus), so
  // queued jobs survive reloads; this set covers the gap before refetch.
  const [transcriptStartedIds, setTranscriptStartedIds] = useState<Set<string>>(new Set());
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  // Search results replace the paged browse list.
  const [searchPage, setSearchPage] = useState<EpisodeListPage>({ episodes: [], total: 0 });
  const [searchError, setSearchError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async ({
      limit,
      offset,
      q,
      includeArchived,
    }: {
      limit: number;
      offset: number;
      q: string;
      includeArchived: boolean;
    }): Promise<EpisodeListPage> => {
      const res = await api.api.episodes.$get({
        query: {
          limit: String(limit),
          offset: String(offset),
          ...(q !== "" ? { q } : {}),
          ...(includeArchived ? { includeArchived: "true" } : {}),
          ...(podcastId !== undefined ? { podcastId } : {}),
        },
      });
      const data = await res.json();
      if ("error" in data) throw new Error(data.error);
      return { episodes: data.episodes, total: data.total };
    },
    [podcastId],
  );

  // Reset pagination when the scope or search changes.
  useEffect(() => {
    setExtraPages([]);
    setLoadError(null);
    setSearchPage({ episodes: [], total: 0 });
    setSearchError(null);
    setArchiveError(null);
  }, [podcastId, trimmedSearch]);

  // A new scope means the loader fetched a fresh first page again.
  useEffect(() => {
    setPage0(null);
    setShowArchived(false);
    setTranscriptStartedIds(new Set());
    setTranscriptError(null);
  }, [podcastId]);

  // Skip the refetch on first mount — the loader already fetched page 0.
  const firstRender = useRef(true);

  // Re-fetch page 0 when the archived toggle (or scope) changes, since the
  // loader only fetches the default active-only first page.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    let cancelled = false;
    setExtraPages([]);
    fetchPage({ limit: PAGE_SIZE, offset: 0, q: "", includeArchived: showArchived })
      .then((page) => {
        if (!cancelled) setPage0(page);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, showArchived]);

  // Fetch matching episodes (all pages, not just loaded). Archived episodes
  // are included only when the toggle is on.
  useEffect(() => {
    if (!isSearching) return;
    let cancelled = false;
    setSearchError(null);
    fetchPage({ limit: PAGE_SIZE, offset: 0, q: trimmedSearch, includeArchived: showArchived })
      .then((page) => {
        if (!cancelled) setSearchPage(page);
      })
      .catch((err) => {
        if (!cancelled) setSearchError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, trimmedSearch, isSearching, showArchived]);

  const page0Episodes = page0?.episodes ?? initial.episodes;
  const page0Total = page0?.total ?? initial.total;
  const browseEpisodes = [...page0Episodes, ...extraPages];
  const episodes = isSearching ? searchPage.episodes : browseEpisodes;
  const shownTotal = isSearching ? searchPage.total : page0Total;
  const hasMore = episodes.length < shownTotal;

  async function loadMore() {
    setLoadError(null);
    setLoadingMore(true);
    try {
      const page = await fetchPage({
        limit: PAGE_SIZE,
        offset: episodes.length,
        q: isSearching ? trimmedSearch : "",
        includeArchived: showArchived,
      });
      if (isSearching) {
        setSearchPage((prev) => ({ ...prev, episodes: [...prev.episodes, ...page.episodes] }));
      } else {
        setExtraPages((prev) => [...prev, ...page.episodes]);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleArchive(ep: EpisodeListItem) {
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
      // Archived rows stay visible (faded) while the toggle is on.
      const mark = (list: EpisodeListItem[]) =>
        list.map((x) => (x.id === ep.id ? { ...x, archived: next } : x));
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
    } catch (err) {
      setPage0(prevPage0);
      setExtraPages(prevExtra);
      setSearchPage(prevSearch);
      setArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setArchivePendingId(null);
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
    loadMore,
    loadingMore,
    loadError: loadError ?? searchError ?? archiveError ?? transcriptError,
    toggleArchive,
    archivePendingId,
    downloadTranscript,
    transcriptPendingId,
    transcriptStartedIds,
  };
}

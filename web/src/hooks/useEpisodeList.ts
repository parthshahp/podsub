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

  const [searchLoading, setSearchLoading] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const searching = query !== debouncedQuery || searchLoading || browseLoading;
  const trimmedSearch = debouncedQuery.trim();
  const isSearching = trimmedSearch !== "";

  // Whether archived episodes are included in the list (hidden by default).
  const [showArchived, setShowArchived] = useState(false);
  // When true, only episodes that already have a transcript are listed.
  const [hasTranscriptOnly, setHasTranscriptOnly] = useState(false);
  // When true, only in-progress episodes (saved position >= 5s) are listed.
  const [inProgressOnly, setInProgressOnly] = useState(false);
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

  // A new identity invalidates pagination immediately, including during debounce.
  const selectionKey = JSON.stringify([
    podcastId,
    query,
    showArchived,
    hasTranscriptOnly,
    inProgressOnly,
  ]);
  const selectionRef = useRef(selectionKey);
  selectionRef.current = selectionKey;
  const moreRequestRef = useRef<object | null>(null);
  useEffect(() => {
    moreRequestRef.current = null;
    setLoadingMore(false);
  }, [selectionKey]);

  useEffect(
    () => () => {
      moreRequestRef.current = null;
    },
    [],
  );

  const fetchPage = useCallback(
    async ({
      limit,
      offset,
      q,
      includeArchived,
      hasTranscriptOnly,
      inProgressOnly,
    }: {
      limit: number;
      offset: number;
      q: string;
      includeArchived: boolean;
      hasTranscriptOnly: boolean;
      inProgressOnly: boolean;
    }): Promise<EpisodeListPage> => {
      const res = await api.api.episodes.$get({
        query: {
          limit: String(limit),
          offset: String(offset),
          ...(q !== "" ? { q } : {}),
          ...(includeArchived ? { includeArchived: "true" } : {}),
          ...(hasTranscriptOnly ? { hasTranscriptOnly: "true" } : {}),
          ...(inProgressOnly ? { inProgressOnly: "true" } : {}),
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
    setHasTranscriptOnly(false);
    setInProgressOnly(false);
    setTranscriptStartedIds(new Set());
    setTranscriptError(null);
  }, [podcastId]);

  // Skip the refetch on first mount — the loader already fetched page 0.
  const firstRender = useRef(true);

  // Re-fetch page 0 when a filter toggle (or scope) changes, since the
  // loader only fetches the default unfiltered first page.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    let cancelled = false;
    setExtraPages([]);
    setLoadError(null);
    setBrowseLoading(true);
    fetchPage({
      limit: PAGE_SIZE,
      offset: 0,
      q: "",
      includeArchived: showArchived,
      hasTranscriptOnly,
      inProgressOnly,
    })
      .then((page) => {
        if (!cancelled) setPage0(page);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setBrowseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, showArchived, hasTranscriptOnly, inProgressOnly]);

  // Fetch matching episodes (all pages, not just loaded). Archived episodes
  // are included only when the toggle is on.
  useEffect(() => {
    if (!isSearching) {
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchError(null);
    setSearchPage({ episodes: [], total: 0 });
    setSearchLoading(true);
    fetchPage({
      limit: PAGE_SIZE,
      offset: 0,
      q: trimmedSearch,
      includeArchived: showArchived,
      hasTranscriptOnly,
      inProgressOnly,
    })
      .then((page) => {
        if (!cancelled) setSearchPage(page);
      })
      .catch((err) => {
        if (!cancelled) setSearchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, trimmedSearch, isSearching, showArchived, hasTranscriptOnly, inProgressOnly]);

  const page0Episodes = page0?.episodes ?? initial.episodes;
  const page0Total = page0?.total ?? initial.total;
  const browseEpisodes = [...page0Episodes, ...extraPages];
  const episodes = isSearching ? searchPage.episodes : browseEpisodes;
  const shownTotal = isSearching ? searchPage.total : page0Total;
  const hasMore = episodes.length < shownTotal;

  const initialRef = useRef(initial);
  initialRef.current = initial;
  const activeJobIds = JSON.stringify(
    [
      ...new Set([
        ...transcriptStartedIds,
        ...[...page0Episodes, ...extraPages, ...searchPage.episodes]
          .filter(
            (ep) =>
              !ep.hasTranscript &&
              (ep.transcribeStatus === "queued" || ep.transcribeStatus === "running"),
          )
          .map((ep) => ep.id),
      ]),
    ].sort(),
  );

  useEffect(() => {
    const ids: string[] = JSON.parse(activeJobIds);
    if (ids.length === 0) return;
    let cancelled = false;
    let polling = false;
    async function poll() {
      if (polling) return;
      polling = true;
      try {
        const updates = await Promise.all(
          ids.map(async (id) => {
            try {
              const res = await api.api.episodes[":id"].$get({ param: { id } });
              const data = await res.json();
              if (!res.ok || "error" in data) return null;
              return data;
            } catch {
              return null; // A transient failure is retried on the next tick.
            }
          }),
        );
        if (cancelled) return;
        const byId = new Map(
          updates.flatMap((data) => (data ? [[data.episode.id, data] as const] : [])),
        );
        const merge = (rows: EpisodeListItem[]) =>
          rows.map((ep) => {
            const data = byId.get(ep.id);
            return data
              ? {
                  ...ep,
                  hasTranscript: data.hasTranscript,
                  transcribeStatus: data.transcribeStatus,
                }
              : ep;
          });
        setPage0((page) => ({
          ...(page ?? initialRef.current),
          episodes: merge((page ?? initialRef.current).episodes),
        }));
        setExtraPages(merge);
        setSearchPage((page) => ({ ...page, episodes: merge(page.episodes) }));
        setTranscriptStartedIds(
          (prev) =>
            new Set(
              [...prev].filter((id) => {
                const data = byId.get(id);
                return (
                  !data ||
                  (!data.hasTranscript &&
                    (data.transcribeStatus === "queued" || data.transcribeStatus === "running"))
                );
              }),
            ),
        );
        const failed = updates.find((data) => data?.transcribeStatus === "failed");
        if (failed)
          setTranscriptError(
            `Transcription failed for “${failed.episode.title}”: ${failed.transcribeError ?? "Please try again."}`,
          );
      } finally {
        polling = false;
      }
    }
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeJobIds, podcastId]);

  async function loadMore() {
    if (searching || !hasMore || moreRequestRef.current) return;
    const request = {};
    const key = selectionKey;
    moreRequestRef.current = request;
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
      if (selectionRef.current !== key || moreRequestRef.current !== request) return;
      if (isSearching) {
        setSearchPage((prev) => ({ ...prev, episodes: [...prev.episodes, ...page.episodes] }));
      } else {
        setExtraPages((prev) => [...prev, ...page.episodes]);
      }
    } catch (err) {
      if (selectionRef.current === key && moreRequestRef.current === request) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (moreRequestRef.current === request) {
        moreRequestRef.current = null;
        setLoadingMore(false);
      }
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
    hasTranscriptOnly,
    setHasTranscriptOnly,
    inProgressOnly,
    setInProgressOnly,
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

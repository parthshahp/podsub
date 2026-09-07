import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { api } from "../../api";
import EpisodeList from "../../components/EpisodeList";
import PodcastHeader from "../../components/PodcastHeader";
import type { Episode } from "../../types";

export const Route = createFileRoute("/$slug/$id")({
  loader: async ({ params: { id } }) => {
    const res = await api.api.podcasts[":id"].$get({ param: { id }, query: {} });
    const data = await res.json();
    if ("error" in data) throw new Error(data.error);
    return data;
  },
  pendingComponent: () => (
    <>
      <main id="main-content" tabIndex={-1} className="p-6">
        <p className="text-sm text-base-content/60">Loading podcast…</p>
      </main>
    </>
  ),
  errorComponent: ({ error }) => (
    <>
      <main id="main-content" tabIndex={-1} className="p-6">
        <p className="text-sm text-error">Failed to load podcast: {error.message}</p>
      </main>
    </>
  ),
  component: PodcastDetail,
});

const PAGE_SIZE = 50;

function PodcastDetail() {
  const { podcast, episodes: firstPage, total } = Route.useLoaderData();
  const [extraPages, setExtraPages] = useState<Episode[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const navigate = useNavigate();

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
  const [page0Override, setPage0Override] = useState<{
    episodes: Episode[];
    total: number;
  } | null>(null);
  const [archivePendingId, setArchivePendingId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  // Skip the refetch on first mount — the loader already fetched page 0.
  const firstRender = useRef(true);

  // Search results replace the paged browse list.
  const [searchEpisodes, setSearchEpisodes] = useState<Episode[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Reset pagination when the podcast or search changes.
  useEffect(() => {
    setExtraPages([]);
    setLoadError(null);
    setSearchEpisodes([]);
    setSearchTotal(0);
    setSearchError(null);
    setArchiveError(null);
  }, [podcast.id, trimmedSearch]);

  // A new podcast means the loader fetched a fresh first page again.
  useEffect(() => {
    setPage0Override(null);
    setShowArchived(false);
  }, [podcast.id]);

  // Re-fetch page 0 when the archived toggle (or podcast) changes, since the
  // loader only fetches the default active-only first page.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    let cancelled = false;
    setExtraPages([]);
    api.api.podcasts[":id"].episodes
      .$get({
        param: { id: podcast.id },
        query: {
          limit: String(PAGE_SIZE),
          offset: "0",
          ...(showArchived ? { includeArchived: "true" } : {}),
        },
      })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if ("error" in data) throw new Error(data.error);
        setPage0Override({ episodes: data.episodes, total: data.total });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [podcast.id, showArchived]);

  // Fetch matching episodes (all pages, not just loaded). Archived episodes
  // are included only when the toggle is on.
  useEffect(() => {
    if (!isSearching) return;
    let cancelled = false;
    setSearchError(null);
    api.api.podcasts[":id"].episodes
      .$get({
        param: { id: podcast.id },
        query: {
          limit: String(PAGE_SIZE),
          offset: "0",
          q: trimmedSearch,
          ...(showArchived ? { includeArchived: "true" } : {}),
        },
      })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if ("error" in data) throw new Error(data.error);
        setSearchEpisodes(data.episodes);
        setSearchTotal(data.total);
      })
      .catch((err) => {
        if (!cancelled) setSearchError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [podcast.id, trimmedSearch, isSearching, showArchived]);

  const page0 = page0Override?.episodes ?? firstPage;
  const page0Total = page0Override?.total ?? total;
  const browseEpisodes = [...page0, ...extraPages];
  const episodes = isSearching ? searchEpisodes : browseEpisodes;
  const shownTotal = isSearching ? searchTotal : page0Total;
  const hasMore = episodes.length < shownTotal;

  async function loadMore() {
    setLoadError(null);
    setLoadingMore(true);
    try {
      const res = await api.api.podcasts[":id"].episodes.$get({
        param: { id: podcast.id },
        query: {
          limit: String(PAGE_SIZE),
          offset: String(episodes.length),
          ...(isSearching ? { q: trimmedSearch } : {}),
          ...(showArchived ? { includeArchived: "true" } : {}),
        },
      });
      const data = await res.json();
      if ("error" in data) throw new Error(data.error);
      if (isSearching) {
        setSearchEpisodes((prev) => [...prev, ...data.episodes]);
      } else {
        setExtraPages((prev) => [...prev, ...data.episodes]);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleArchive(ep: Episode) {
    const next = !ep.archived;
    setArchivePendingId(ep.id);
    setArchiveError(null);
    // Snapshot for rollback if the request fails.
    const prevPage0 = page0Override;
    const prevExtra = extraPages;
    const prevSearch = searchEpisodes;
    const prevSearchTotal = searchTotal;

    if (next && !showArchived) {
      // Archiving hides the row from the default list: drop it everywhere.
      // page0 falls back to the loader's first page when no refetch ran yet.
      setPage0Override((p) => {
        const base = p ?? { episodes: firstPage, total };
        return { episodes: base.episodes.filter((x) => x.id !== ep.id), total: base.total - 1 };
      });
      setExtraPages((prev) => prev.filter((x) => x.id !== ep.id));
      setSearchEpisodes((prev) => prev.filter((x) => x.id !== ep.id));
      if (isSearching) setSearchTotal((t) => t - 1);
    } else {
      // Archived rows stay visible (faded) while the toggle is on.
      const mark = (list: Episode[]) =>
        list.map((x) => (x.id === ep.id ? { ...x, archived: next } : x));
      setPage0Override((p) => {
        const base = p ?? { episodes: firstPage, total };
        return { ...base, episodes: mark(base.episodes) };
      });
      setExtraPages(mark);
      setSearchEpisodes(mark);
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
      setPage0Override(prevPage0);
      setExtraPages(prevExtra);
      setSearchEpisodes(prevSearch);
      setSearchTotal(prevSearchTotal);
      setArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setArchivePendingId(null);
    }
  }

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-6 py-8">
      <PodcastHeader podcast={podcast} />
      <EpisodeList
        episodes={episodes}
        total={shownTotal}
        query={query}
        onQueryChange={setQuery}
        searching={searching}
        onPlay={(e) =>
          navigate({
            to: "/player/$episodeId",
            params: { episodeId: e.id },
          })
        }
        hasMore={hasMore}
        loadingMore={loadingMore}
        loadError={loadError ?? searchError ?? archiveError}
        onLoadMore={loadMore}
        onToggleArchive={toggleArchive}
        archivePendingId={archivePendingId}
        showArchived={showArchived}
        onShowArchivedChange={setShowArchived}
      />
    </main>
  );
}

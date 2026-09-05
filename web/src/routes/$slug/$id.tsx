import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

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
  }, [podcast.id, trimmedSearch]);

  // Fetch matching episodes (all pages, not just loaded).
  useEffect(() => {
    if (!isSearching) return;
    let cancelled = false;
    setSearchError(null);
    api.api.podcasts[":id"].episodes
      .$get({
        param: { id: podcast.id },
        query: { limit: String(PAGE_SIZE), offset: "0", q: trimmedSearch },
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
  }, [podcast.id, trimmedSearch, isSearching]);

  const browseEpisodes = [...firstPage, ...extraPages];
  const episodes = isSearching ? searchEpisodes : browseEpisodes;
  const shownTotal = isSearching ? searchTotal : total;
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
        loadError={loadError ?? searchError}
        onLoadMore={loadMore}
      />
    </main>
  );
}

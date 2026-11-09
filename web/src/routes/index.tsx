import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { api } from "../api";
import PageShell, { pageLoadState } from "../components/PageShell";
import PodcastList from "../components/PodcastList";
import { isPodcastSort, sortPodcasts } from "../lib/sortPodcasts";

// List, pending state and error state share one shell so the scroll container
// doesn't appear and disappear across loads.
const LIST_SHELL = "min-h-0 flex-1 overflow-y-auto";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => {
    const q = typeof search.q === "string" ? search.q : undefined;
    const sort = isPodcastSort(search.sort) ? search.sort : undefined;
    return { ...(q ? { q } : {}), ...(sort ? { sort } : {}) };
  },
  loader: async () => {
    const res = await api.api.podcasts.$get();
    const podcasts = await res.json();
    return { podcasts };
  },
  ...pageLoadState("podcasts", LIST_SHELL),
  component: PodcastsPage,
});

function PodcastsPage() {
  const { podcasts } = Route.useLoaderData();
  const { q, sort = "added" } = Route.useSearch();
  const filtered = useMemo(() => {
    const needle = q?.trim().toLowerCase();
    const matching = needle
      ? podcasts.filter((p) => p.title.toLowerCase().includes(needle))
      : podcasts;
    return sortPodcasts(matching, sort);
  }, [podcasts, q, sort]);
  return (
    <PageShell className={LIST_SHELL}>
      <PodcastList filteredPodcasts={filtered} q={q} sort={sort} />
    </PageShell>
  );
}

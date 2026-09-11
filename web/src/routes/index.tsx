import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { api } from "../api";
import PageShell, { pageLoadState } from "../components/PageShell";
import PodcastList from "../components/PodcastList";

// List, pending state and error state share one shell so the scroll container
// doesn't appear and disappear across loads.
const LIST_SHELL = "min-h-0 flex-1 overflow-y-auto";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => {
    const q = typeof search.q === "string" ? search.q : undefined;
    return q ? { q } : {};
  },
  loader: async () => {
    const res = await api.api.podcasts.$get();
    const podcasts = await res.json();
    return { podcasts };
  },
  ...pageLoadState("podcasts", LIST_SHELL),
  component: () => {
    const { podcasts } = Route.useLoaderData();
    const { q } = Route.useSearch();
    const filtered = useMemo(() => {
      const needle = q?.trim().toLowerCase();
      return needle ? podcasts.filter((p) => p.title.toLowerCase().includes(needle)) : podcasts;
    }, [podcasts, q]);
    return (
      <PageShell className={LIST_SHELL}>
        <PodcastList filteredPodcasts={filtered} q={q} />
      </PageShell>
    );
  },
});

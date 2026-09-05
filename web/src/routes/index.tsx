import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { api } from "../api";
import PodcastList from "../components/PodcastList";

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
  pendingComponent: () => <PodcastListShell>Loading podcasts…</PodcastListShell>,
  errorComponent: ({ error }) => (
    <PodcastListShell>
      <p className="text-sm text-error">Failed to load podcasts: {error.message}</p>
    </PodcastListShell>
  ),
  component: () => {
    const { podcasts } = Route.useLoaderData();
    const { q } = Route.useSearch();
    const filtered = useMemo(() => {
      const needle = q?.trim().toLowerCase();
      return needle ? podcasts.filter((p) => p.title.toLowerCase().includes(needle)) : podcasts;
    }, [podcasts, q]);
    return (
      <PodcastListShell>
        <PodcastList filteredPodcasts={filtered} q={q} />
      </PodcastListShell>
    );
  },
});

function PodcastListShell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
      {children}
    </main>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { api } from "../api";
import EpisodeList from "../components/EpisodeList";
import PageShell, { pageLoadState } from "../components/PageShell";
import { useEpisodeList } from "../hooks/useEpisodeList";

export const Route = createFileRoute("/episodes")({
  loader: async () => {
    const res = await api.api.episodes.$get({ query: { limit: "50", offset: "0" } });
    const data = await res.json();
    if ("error" in data) throw new Error(data.error);
    return data;
  },
  ...pageLoadState("episodes"),
  component: AllEpisodes,
});

function AllEpisodes() {
  const initial = Route.useLoaderData();
  const navigate = useNavigate();
  // No podcast scope: the generic endpoint lists across all shows.
  const list = useEpisodeList({ initial });

  return (
    <PageShell className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">All episodes</h1>
      <EpisodeList
        episodes={list.episodes}
        total={list.total}
        query={list.query}
        onQueryChange={list.setQuery}
        searching={list.searching}
        showPodcast
        onPlay={(e) => navigate({ to: "/player/$episodeId", params: { episodeId: e.id } })}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        loadError={list.loadError}
        onLoadMore={list.loadMore}
        onToggleArchive={list.toggleArchive}
        archivePendingId={list.archivePendingId}
        onDownloadTranscript={list.downloadTranscript}
        transcriptPendingId={list.transcriptPendingId}
        transcriptStartedIds={list.transcriptStartedIds}
        showArchived={list.showArchived}
        onShowArchivedChange={list.setShowArchived}
      />
    </PageShell>
  );
}

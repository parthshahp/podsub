import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { api } from "../api";
import EpisodeList from "../components/EpisodeList";
import { ArchiveIcon, PlayIcon, TranscriptIcon } from "../components/icons";
import PageShell, { pageLoadState } from "../components/PageShell";
import PodcastFilter from "../components/PodcastFilter";
import { useEpisodeList } from "../hooks/useEpisodeList";

export const Route = createFileRoute("/episodes")({
  loader: async () => {
    const [res, podcastsRes] = await Promise.all([
      api.api.episodes.$get({ query: { limit: "50", offset: "0" } }),
      api.api.podcasts.$get(),
    ]);
    const [data, podcasts] = await Promise.all([res.json(), podcastsRes.json()]);
    if ("error" in data) throw new Error(data.error);
    if (!podcastsRes.ok) throw new Error("Could not load podcasts");
    return { ...data, podcasts };
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
        groupByMonth
        podcastFilterActive={list.podcastFilter.ids.length > 0}
        filterControls={
          <PodcastFilter
            podcasts={initial.podcasts}
            value={list.podcastFilter}
            onChange={list.setPodcastFilter}
          />
        }
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
        filters={[
          {
            key: "in-progress",
            label: "In progress",
            icon: <PlayIcon className="h-4 w-4" />,
            active: list.inProgressOnly,
            onToggle: list.setInProgressOnly,
          },
          {
            key: "has-transcript",
            label: "Has transcript",
            icon: <TranscriptIcon className="h-4 w-4" />,
            active: list.hasTranscriptOnly,
            onToggle: list.setHasTranscriptOnly,
          },
          {
            key: "show-archived",
            label: "Show archived",
            icon: <ArchiveIcon className="h-4 w-4" />,
            active: list.showArchived,
            onToggle: list.setShowArchived,
          },
        ]}
      />
    </PageShell>
  );
}

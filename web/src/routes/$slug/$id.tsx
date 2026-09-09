import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { api } from "../../api";
import EpisodeList from "../../components/EpisodeList";
import PodcastHeader from "../../components/PodcastHeader";
import { useEpisodeList } from "../../hooks/useEpisodeList";

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

function PodcastDetail() {
  const { podcast, episodes: firstPage, total } = Route.useLoaderData();
  const navigate = useNavigate();
  // Episode pages, search, archive and transcription state all live in the
  // shared hook; this page just scopes the generic list to this podcast.
  const list = useEpisodeList({
    initial: { episodes: firstPage, total },
    podcastId: podcast.id,
  });

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-6 py-8">
      <PodcastHeader podcast={podcast} />
      <EpisodeList
        episodes={list.episodes}
        total={list.total}
        query={list.query}
        onQueryChange={list.setQuery}
        searching={list.searching}
        onPlay={(e) =>
          navigate({
            to: "/player/$episodeId",
            params: { episodeId: e.id },
          })
        }
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
    </main>
  );
}

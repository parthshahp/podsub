import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Fragment, useState, type FormEvent } from "react";
import type { TranscriptSearchResult } from "@podsub/schemas";

import { api } from "../api";
import PageShell, { pageLoadState } from "../components/PageShell";
import { PlayIcon, SearchIcon } from "../components/icons";
import { formatClock } from "../lib/format";

const PAGE_SIZE = 20;

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q.trim().slice(0, 200) : "",
    podcastId: typeof search.podcastId === "string" ? search.podcastId.slice(0, 200) : "",
    page: Number.isInteger(Number(search.page))
      ? Math.max(0, Math.min(5000, Number(search.page)))
      : 0,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps: { q, podcastId, page } }) => {
    const [res, podcastsRes] = await Promise.all([
      api.api.search.transcripts.$get({
        query: {
          q,
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
          ...(podcastId ? { podcastId } : {}),
        },
      }),
      api.api.podcasts.$get(),
    ]);
    const [data, podcasts] = await Promise.all([res.json(), podcastsRes.json()]);
    if ("error" in data) throw new Error(data.error);
    if (!res.ok) throw new Error("Could not search transcripts");
    if (!podcastsRes.ok) throw new Error("Could not load podcasts");
    return { ...data, podcasts };
  },
  ...pageLoadState("transcript search", "mx-auto max-w-3xl px-6 py-8"),
  component: TranscriptSearchPage,
});

function TranscriptSearchPage() {
  const { q, podcastId, page } = Route.useSearch();
  const data = Route.useLoaderData();
  const pending = useRouterState({ select: (state) => state.status === "pending" });

  return (
    <PageShell className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Search transcripts</h1>
      <p id="search-help" className="mt-2 text-sm text-base-content/60">
        Find a word or phrase in your saved transcripts, then listen in context.
      </p>
      <SearchForm
        key={`${q}:${podcastId}`}
        q={q}
        podcastId={podcastId}
        podcasts={data.podcasts}
        pending={pending}
      />
      <section aria-label="Transcript search results" aria-busy={pending} className="mt-8">
        <p role="status" className="text-sm text-base-content/60">
          {pending
            ? "Searching…"
            : !q
              ? "Search Chinese characters or a literal word or phrase. Played episodes are included."
              : data.total === 0
                ? `No examples found for “${q}”.`
                : `${data.total} matching ${data.total === 1 ? "passage" : "passages"} for “${q}”`}
        </p>
        {q && data.total === 0 && !pending ? (
          <p className="mt-3 text-sm text-base-content/60">
            Try a shorter phrase or another podcast. Only episodes with saved transcripts are
            searchable.
          </p>
        ) : null}
        <ol className="mt-3 divide-y divide-base-300">
          {data.results.map((result) => (
            <li key={`${result.episodeId}:${result.passageNumber}`} className="py-5">
              <p className="text-xs font-medium text-base-content/60">{result.podcastTitle}</p>
              <h2 className="mt-1 text-sm font-medium">{result.episodeTitle}</h2>
              <p className="mt-3 break-words text-lg leading-relaxed">
                <HighlightedText result={result} />
              </p>
              <Link
                to="/player/$episodeId"
                params={{ episodeId: result.episodeId }}
                search={{ t: Math.max(result.startSec, result.matchSec - 0.75) }}
                className="btn btn-ghost mt-2 min-h-11 gap-2 px-2 text-primary active:scale-[0.97]"
                aria-label={`Listen at ${formatClock(result.matchSec)} in ${result.episodeTitle}`}
              >
                <PlayIcon className="h-4 w-4" />
                <span className="tabular-nums">{formatClock(result.matchSec)}</span>
                <span>Listen in context</span>
              </Link>
            </li>
          ))}
        </ol>
        {q && (page > 0 || data.total > PAGE_SIZE) ? (
          <nav
            aria-label="Search result pages"
            className="mt-4 flex items-center justify-between gap-3"
          >
            {page > 0 ? (
              <Link
                to="/search"
                search={{ q, podcastId, page: page - 1 }}
                className="btn btn-outline"
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm text-base-content/60">Page {page + 1}</span>
            {(page + 1) * PAGE_SIZE < data.total && page < 5000 ? (
              <Link
                to="/search"
                search={{ q, podcastId, page: page + 1 }}
                className="btn btn-outline"
              >
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </PageShell>
  );
}

function SearchForm({
  q,
  podcastId,
  podcasts,
  pending,
}: {
  q: string;
  podcastId: string;
  podcasts: { id: string; title: string }[];
  pending: boolean;
}) {
  const [query, setQuery] = useState(q);
  const [podcast, setPodcast] = useState(podcastId);
  const navigate = useNavigate();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void navigate({ to: "/search", search: { q: query.trim(), podcastId: podcast, page: 0 } });
  }
  return (
    <form
      onSubmit={submit}
      role="search"
      aria-label="Search saved transcripts"
      className="mt-6 space-y-3"
    >
      <label htmlFor="transcript-query" className="sr-only">
        Word or phrase
      </label>
      <div className="flex gap-2">
        <input
          id="transcript-query"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={200}
          placeholder="e.g. 学习 or take your time"
          aria-describedby="search-help"
          className="input input-bordered min-h-11 min-w-0 flex-1"
        />
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary min-h-11 active:scale-[0.97]"
        >
          <SearchIcon className="h-4 w-4" />
          <span>Search</span>
        </button>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <span className="shrink-0 text-base-content/60">Podcast</span>
        <select
          value={podcast}
          onChange={(event) => setPodcast(event.target.value)}
          className="select select-bordered min-h-11 min-w-0 flex-1 sm:max-w-xs"
        >
          <option value="">All podcasts</option>
          {podcasts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}

function HighlightedText({ result }: { result: TranscriptSearchResult }) {
  return (
    <>
      {result.highlights.map(({ start, end }, index) => (
        <Fragment key={start}>
          {result.text.slice(index === 0 ? 0 : result.highlights[index - 1]!.end, start)}
          <mark className="rounded-sm bg-primary/15 px-0.5 text-inherit">
            {result.text.slice(start, end)}
          </mark>
        </Fragment>
      ))}
      {result.text.slice(result.highlights.at(-1)?.end ?? 0)}
    </>
  );
}

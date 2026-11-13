import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { api } from "../api";
import { SearchIcon } from "./icons";
import { kebabCase } from "../lib/kebab";
import { podcastImageSrcSet, podcastImageUrl } from "../lib/podcastImage";
import { isPodcastSort, podcastSortOptions, type PodcastSort } from "../lib/sortPodcasts";
import type { PodcastList } from "../types";

type Props = {
  filteredPodcasts: PodcastList[];
  q: string | undefined;
  sort: PodcastSort;
  searching: boolean;
  searchError: string | null;
};

export default function PodcastList({ filteredPodcasts, q, sort, searching, searchError }: Props) {
  const navigate = useNavigate({ from: "/" });
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Podcasts</h1>
          <p className="mt-1 text-sm text-base-content/60">
            {filteredPodcasts.length} {filteredPodcasts.length === 1 ? "show" : "shows"}
          </p>
        </div>
        <RssFeedForm />
      </div>

      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="input flex w-full min-w-0 items-center gap-2 sm:flex-1">
          <SearchIcon className="h-4 w-4 shrink-0 text-base-content/40" />
          <input
            type="search"
            placeholder="Filter by name or pinyin…"
            aria-label="Filter podcasts"
            aria-busy={searching}
            value={q ?? ""}
            onChange={(e) => {
              navigate({
                search: (previous) => ({ ...previous, q: e.target.value }),
                replace: true,
                resetScroll: false,
              });
            }}
            className="grow"
          />
        </label>
        <label className="flex shrink-0 items-center gap-2 text-sm text-base-content/60">
          <span>Sort by</span>
          <select
            aria-label="Sort podcasts"
            className="select min-w-0 flex-1 text-base text-base-content sm:flex-none sm:text-sm"
            value={sort}
            onChange={(event) => {
              const next = event.target.value;
              if (!isPodcastSort(next)) return;
              navigate({
                search: (previous) => ({ ...previous, sort: next }),
                replace: true,
                resetScroll: false,
              });
            }}
          >
            {podcastSortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p
        role="status"
        className={searching || searchError ? "mb-3 text-sm text-base-content/60" : "sr-only"}
      >
        {searching ? "Loading pinyin search…" : searchError}
      </p>

      {filteredPodcasts.length > 0 ? (
        <ul
          aria-busy={searching}
          className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-6 gap-y-8"
        >
          {filteredPodcasts.map((p) => (
            <li key={p.id}>
              <Link
                to="/$slug/$id"
                params={{ slug: kebabCase(p.title), id: p.id }}
                className="group block"
              >
                {p.imageUrl ? (
                  <img
                    src={podcastImageUrl(p.id, 256)}
                    data-podcast-artwork={p.id}
                    srcSet={podcastImageSrcSet(p.id, 256, 512)}
                    alt={p.title}
                    loading="lazy"
                    decoding="async"
                    width={240}
                    height={240}
                    className="aspect-square w-full rounded-lg object-cover shadow-sm transition-[transform,box-shadow] duration-200 ease-out group-hover:scale-[1.02] group-hover:shadow-md"
                  />
                ) : (
                  <span
                    data-podcast-artwork={p.id}
                    className="flex aspect-square w-full items-center justify-center rounded-lg bg-base-300 p-3 text-center text-sm text-base-content/60 transition-[transform,box-shadow] duration-200 ease-out group-hover:scale-[1.02] group-hover:shadow-md"
                  >
                    {p.title}
                  </span>
                )}
                <p className="mt-2.5 truncate text-sm font-medium group-hover:text-primary">
                  {p.title}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : !searching && !searchError ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="font-medium">No podcasts found</p>
          <p className="text-sm text-base-content/60">
            {q
              ? "Try a different search, or paste an RSS feed above to add one."
              : "Paste an RSS feed above to add your first podcast."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function RssFeedForm() {
  const [feedUrl, setFeedUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function addPodcast() {
    const trimmed = feedUrl.trim();
    if (trimmed === "") return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.api.podcasts.$post({ json: { feedUrl: trimmed } });
      if (!res.ok) {
        const data = await res.json();
        setError("error" in data ? data.error : "Import failed");
        return;
      }
      setFeedUrl("");
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-2 sm:w-auto">
      <form
        className="join"
        onSubmit={(e) => {
          e.preventDefault();
          if (!submitting && feedUrl.trim() !== "") addPodcast();
        }}
      >
        <input
          type="url"
          placeholder="Paste RSS feed URL…"
          aria-label="RSS feed URL"
          aria-invalid={error != null}
          aria-describedby={error ? "rss-feed-error" : undefined}
          value={feedUrl}
          onChange={(e) => setFeedUrl(e.target.value)}
          className="input join-item min-w-0 grow"
        />
        <button
          type="submit"
          className="btn btn-primary join-item"
          disabled={submitting || feedUrl.trim() === ""}
        >
          {submitting && <span className="loading loading-spinner loading-sm" />}
          {submitting ? "Adding…" : "Add"}
        </button>
      </form>
      {error && (
        <p id="rss-feed-error" role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";

import { hasChinese, searchPodcastTitles, type PodcastSearch } from "../lib/podcastSearch";

let loadedSearch: PodcastSearch | null = null;
let pendingSearch: Promise<PodcastSearch> | null = null;

function loadPinyinSearch(): Promise<PodcastSearch> {
  return (pendingSearch ??= import("../lib/pinyinSearch")
    .then(({ searchPodcasts }) => (loadedSearch = searchPodcasts))
    .catch((error) => {
      pendingSearch = null;
      throw error;
    }));
}

/** Both podcast pickers share a lazy dictionary and title-keyed alias cache. */
export function usePodcastSearch<T extends { title: string }>(podcasts: T[], query = "") {
  const [search, setSearch] = useState<PodcastSearch | null>(() => loadedSearch);
  const [error, setError] = useState<string | null>(null);
  const needsPinyin = /\p{Script=Latin}/u.test(query) && podcasts.some((p) => hasChinese(p.title));

  useEffect(() => {
    if (search || !needsPinyin) return;
    let cancelled = false;
    setError(null);
    loadPinyinSearch().then(
      (match) => {
        if (!cancelled) setSearch(() => match);
      },
      () => {
        if (!cancelled)
          setError("Pinyin search unavailable. Try the Chinese title, or clear and retry.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [search, needsPinyin]);

  return {
    podcasts: (search ?? searchPodcastTitles)(podcasts, query),
    searching: needsPinyin && !search && !error,
    error: needsPinyin ? error : null,
  };
}

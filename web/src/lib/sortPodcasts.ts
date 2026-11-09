export const podcastSortOptions = [
  { value: "name", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
  { value: "released", label: "Latest episode (newest first)" },
  { value: "released-asc", label: "Latest episode (oldest first)" },
  { value: "added", label: "Date added (newest first)" },
  { value: "added-asc", label: "Date added (oldest first)" },
] as const;

export type PodcastSort = (typeof podcastSortOptions)[number]["value"];

export function isPodcastSort(value: unknown): value is PodcastSort {
  return podcastSortOptions.some((option) => option.value === value);
}

type SortablePodcast = {
  id: string;
  title: string;
  createdAt: string;
  latestEpisodeAt: string | null;
};

export function sortPodcasts<T extends SortablePodcast>(podcasts: T[], sort: PodcastSort): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const byName = (a: T, b: T) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id);
  return [...podcasts].sort((a, b) => {
    if (sort === "name") return byName(a, b);
    if (sort === "name-desc") return -byName(a, b);
    const released = sort === "released" || sort === "released-asc";
    const aDate = released ? a.latestEpisodeAt : a.createdAt;
    const bDate = released ? b.latestEpisodeAt : b.createdAt;
    // Undated shows always stay at the end, in either direction.
    if (aDate == null) return bDate == null ? byName(a, b) : 1;
    if (bDate == null) return -1;
    const difference = Date.parse(aDate) - Date.parse(bDate);
    return (sort.endsWith("-asc") ? difference : -difference) || byName(a, b);
  });
}

type DatedEpisode = { publishedAt: string | null };

type MonthGroup<T> = {
  key: string;
  label: string;
  episodes: T[];
};

/** Preserve the server's newest-first order, including across loaded pages. */
export function groupEpisodesByMonth<T extends DatedEpisode>(episodes: T[]): MonthGroup<T>[] {
  const groups = new Map<string, MonthGroup<T>>();
  const formatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

  for (const episode of episodes) {
    const date = episode.publishedAt ? new Date(episode.publishedAt) : null;
    const validDate = date && Number.isFinite(date.getTime()) ? date : null;
    // Use local dates, matching the dates displayed on episode rows.
    const key = validDate ? `${validDate.getFullYear()}-${validDate.getMonth()}` : "undated";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: validDate ? formatter.format(validDate) : "Unknown date",
        episodes: [],
      };
      groups.set(key, group);
    }
    group.episodes.push(episode);
  }

  return [...groups.values()];
}

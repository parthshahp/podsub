export type PodcastSearch = <T extends { title: string }>(podcasts: T[], query: string) => T[];

export const hasChinese = (text: string) => /\p{Script=Han}/u.test(text);

function normalizePinyin(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      // Accept both ü (including its tone-marked forms) and keyboard-friendly v.
      .replace(/u\u0308/g, "v")
      .replace(/\p{M}/gu, "")
      .replace(/[\s\p{P}]+/gu, "")
  );
}

/** Preserve literal title matching; pinyin adds aliases only for Chinese titles. */
export function createPodcastSearch(transliterate?: (title: string) => string): PodcastSearch {
  const aliases = new Map<string, string>();
  return (podcasts, query) => {
    const literal = query.trim().toLowerCase();
    if (!literal) return podcasts;
    const needle = normalizePinyin(literal);
    return podcasts.filter((podcast) => {
      if (podcast.title.toLowerCase().includes(literal)) return true;
      if (!transliterate || !needle || !hasChinese(podcast.title)) return false;
      let alias = aliases.get(podcast.title);
      if (alias === undefined) {
        alias = normalizePinyin(transliterate(podcast.title));
        // Bound memory across feed refreshes and title changes.
        if (aliases.size >= 1000) aliases.clear();
        aliases.set(podcast.title, alias);
      }
      return alias.includes(needle);
    });
  };
}

export const searchPodcastTitles = createPodcastSearch();

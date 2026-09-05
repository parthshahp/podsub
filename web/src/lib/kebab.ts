/** "The Daily News!" → "the-daily-news"; non-Latin titles fall back to "podcast" */
export function kebabCase(s: string): string {
  const kebab = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // "程序员新声" → "" — an empty param would produce a broken URL like //123
  return kebab || "podcast";
}

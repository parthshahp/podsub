/**
 * Strip HTML tags and decode entities from feed-supplied descriptions.
 * DOMParser doesn't execute scripts/fetch resources — this is a strip,
 * not a sanitizer for rendering raw HTML.
 */
export function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Paragraphs would jam together; collapse whitespace into one block.
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

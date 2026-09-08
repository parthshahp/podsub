// Same-origin artwork thumbnails served by GET /api/podcasts/:id/image?size=.
//
// Feed-supplied originals are 1400-3000px (hundreds of KB+); the server
// resizes to one of these buckets, caches the result, and returns a small
// progressive JPEG. Same-origin also means shared HTTP/2 connections and no
// per-CDN TLS setup, unlike hotlinking each feed's CDN directly.
//
// The bare /image URL (no ?size=) still streams the original — Anki card
// media keeps using that via loadPodcastImage.

export type PodcastThumbSize = 96 | 256 | 512;

/** Thumbnail URL for a podcast at the given bucket size. */
export function podcastImageUrl(podcastId: string, size: PodcastThumbSize): string {
  return `/api/podcasts/${podcastId}/image?size=${size}`;
}

/** `srcSet` pairing a 1x size with its 2x retina partner. */
export function podcastImageSrcSet(
  podcastId: string,
  size1x: PodcastThumbSize,
  size2x: PodcastThumbSize,
): string {
  return `${podcastImageUrl(podcastId, size1x)} 1x, ${podcastImageUrl(podcastId, size2x)} 2x`;
}

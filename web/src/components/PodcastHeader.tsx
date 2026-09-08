import { useState } from "react";

import { stripHtml } from "../lib/html";
import type { Podcast } from "../types";

export default function PodcastHeader({ podcast }: { podcast: Podcast }) {
  const [expanded, setExpanded] = useState(false);

  const feedHost = (() => {
    try {
      return new URL(podcast.feedUrl).hostname;
    } catch {
      return null;
    }
  })();

  const description = podcast.description ? stripHtml(podcast.description) : "";
  const isLong = description.length > 180;

  return (
    <section className="flex flex-col gap-4 sm:flex-row sm:gap-8">
      {podcast.imageUrl ? (
        <img
          src={podcast.imageUrl}
          alt={podcast.title}
          width={192}
          height={192}
          loading="eager"
          fetchPriority="high"
          className="h-28 w-28 shrink-0 rounded-lg object-cover shadow-sm sm:h-48 sm:w-48"
        />
      ) : (
        <span className="flex h-48 w-48 shrink-0 items-center justify-center rounded-lg bg-base-300 p-4 text-center text-sm text-base-content/60">
          {podcast.title}
        </span>
      )}
      <div className="flex min-w-0 flex-col pt-1">
        <h1 className="text-2xl font-bold tracking-tight break-words sm:text-3xl">
          {podcast.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-base-content/60">
          {podcast.author && <span>{podcast.author}</span>}
          {feedHost && (
            <a href={podcast.feedUrl} target="_blank" rel="noreferrer" className="link link-hover">
              {feedHost}
            </a>
          )}
        </div>
        {description && (
          <>
            <p
              className={`mt-4 text-[15px] leading-relaxed text-base-content/80 ${
                expanded || !isLong ? "" : "line-clamp-3"
              }`}
            >
              {description}
            </p>
            {isLong && (
              <button
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                className="btn btn-link btn-xs mt-1 min-h-11 self-end"
              >
                {expanded ? "Show Less" : "Read More"}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

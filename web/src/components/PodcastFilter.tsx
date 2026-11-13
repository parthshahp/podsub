import { useState } from "react";

import type { PodcastFilter as PodcastFilterValue } from "../hooks/useEpisodeList";
import { usePodcastSearch } from "../hooks/usePodcastSearch";

type Props = {
  podcasts: { id: string; title: string }[];
  value: PodcastFilterValue;
  onChange: (value: PodcastFilterValue) => void;
};

export default function PodcastFilter({ podcasts, value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const selected = new Set(value.ids);
  const { podcasts: visible, searching, error } = usePodcastSearch(podcasts, query);
  const active = selected.size > 0;

  return (
    <details
      className="basis-full"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary
        className={`w-fit cursor-pointer rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${
          active
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-base-300 text-base-content/60 hover:border-base-content/30 hover:text-base-content"
        }`}
      >
        {active
          ? `${value.mode === "include" ? "Only" : "Excluding"} ${selected.size} podcast${selected.size === 1 ? "" : "s"}`
          : "Podcasts"}
      </summary>
      <div className="mt-3 max-w-md rounded-xl border border-base-300 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Podcast filter mode</span>
            <select
              aria-label="Podcast filter mode"
              className="select select-sm w-auto"
              value={value.mode}
              onChange={(event) =>
                onChange({ ...value, mode: event.target.value as PodcastFilterValue["mode"] })
              }
            >
              <option value="include">Only selected</option>
              <option value="exclude">Exclude selected</option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!active}
            onClick={() => onChange({ ...value, ids: [] })}
          >
            Clear
          </button>
        </div>
        <input
          type="search"
          aria-label="Find podcasts to filter"
          aria-busy={searching}
          placeholder="Find podcasts by name or pinyin…"
          className="input input-sm mt-3 w-full text-base sm:text-sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p
          role="status"
          className={searching || error ? "mt-2 text-xs text-base-content/60" : "sr-only"}
        >
          {searching ? "Loading pinyin search…" : error}
        </p>
        <fieldset
          aria-busy={searching}
          className="mt-2 max-h-64 overflow-y-auto overscroll-contain"
        >
          <legend className="sr-only">
            Podcasts to {value.mode === "include" ? "include" : "exclude"}
          </legend>
          {visible.map((podcast) => (
            <label
              key={podcast.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-base-200"
            >
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={selected.has(podcast.id)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    ids: event.target.checked
                      ? [...value.ids, podcast.id]
                      : value.ids.filter((id) => id !== podcast.id),
                  })
                }
              />
              <span className="min-w-0 text-sm break-words">{podcast.title}</span>
            </label>
          ))}
          {visible.length === 0 && !searching && !error && (
            <p className="px-2 py-3 text-sm text-base-content/60">No podcasts found.</p>
          )}
        </fieldset>
        <p className="mt-2 text-xs text-base-content/60">
          {active
            ? value.mode === "include"
              ? "Showing only selected podcasts."
              : "Hiding selected podcasts."
            : "All podcasts shown. Select podcasts to filter the list."}
        </p>
      </div>
    </details>
  );
}

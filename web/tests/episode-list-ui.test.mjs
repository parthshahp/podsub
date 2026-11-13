import assert from "node:assert/strict";
import { test } from "node:test";
import { createHarness, elements, loadScript } from "./helpers/hookHarness.mjs";

const script = await loadScript(
  new URL("../src/components/EpisodeList.tsx", import.meta.url),
  "EpisodeList",
);
function setup(props = {}) {
  return createHarness(
    script,
    {
      Link: "Link",
      MobileEpisodeRow: "MobileEpisodeRow",
      SearchIcon: "SearchIcon",
      PlayIcon: "PlayIcon",
      ArchiveIcon: "ArchiveIcon",
      UnarchiveIcon: "UnarchiveIcon",
      TranscriptIcon: "TranscriptIcon",
      kebabCase: (text) => text,
      formatDate: (date) => date,
      formatDuration: (duration) => duration,
    },
    (module) => module.EpisodeList,
    {
      episodes: [],
      total: 0,
      query: "query",
      searching: false,
      filters: [],
      transcriptStartedIds: new Set(),
      archivePendingId: null,
      archiveUndo: null,
      loadError: null,
      ...props,
    },
  );
}

test("pending searches announce loading instead of displaying a false empty state", () => {
  const h = setup({ searching: true, hasMore: true });
  const tree = h.render();
  const input = elements(tree, "input")[0];
  assert.equal(input.props["aria-busy"], true);
  assert.match(input.props.className, /focus-visible:outline/);
  assert.match(JSON.stringify(tree), /Searching…/);
  assert.doesNotMatch(JSON.stringify(tree), /No episodes match|Load more/);
  const completed = setup().render();
  assert.match(JSON.stringify(completed), /No episodes match/);
});

test("both desktop episode layouts allow two-line titles", () => {
  for (const showPodcast of [false, true]) {
    const h = setup({
      showPodcast,
      episodes: [{ id: "e1", title: "A long episode title", podcast: { id: "p1", title: "Show" } }],
    });
    const title = elements(h.render(), "Link").find(
      (link) => link.props["data-episode-title"] === "e1",
    );
    assert.match(title.props.className, /line-clamp-2/);
    assert.doesNotMatch(title.props.className, /truncate/);
  }
});

test("Undo stays visible above mobile navigation and shows progress during restoration", () => {
  const h = setup({ archiveUndo: { title: "Archived episode" }, undoingArchive: true });
  const tree = h.render();
  const undo = elements(tree, "button").find((button) => button.props.children === "Restoring…");
  assert.equal(undo.props.disabled, true);
  const notice = elements(tree, "div").find((div) => div.props.className?.includes("fixed"));
  assert.match(notice.props.className, /safe-area-inset-bottom/);
});

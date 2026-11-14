import assert from "node:assert/strict";
import { test } from "node:test";
import { createHarness, elements, loadScript } from "./helpers/hookHarness.mjs";

const pane = await loadScript(
  new URL("../src/components/player/TranscriptPane.tsx", import.meta.url),
  "TranscriptPane",
);
const words = await loadScript(
  new URL("../src/components/WordSpans.tsx", import.meta.url),
  "WordSpans",
);
const props = {
  lines: Array.from({ length: 12 }, (_, i) => ({ start: i, text: `Line ${i}` })),
  activeIdx: 0,
  follow: true,
  containerRef: { current: null },
  onSeekLine() {},
  onExplainLine() {},
  onWordOver() {},
  onWordOut() {},
  onWordClick() {},
  onUserScroll() {},
  onScroll() {},
  onResumeFollow() {},
};

function rows(dialogKey) {
  const h = createHarness(
    pane,
    { memo: (fn) => fn, TranscriptLine: "TranscriptLine" },
    (module) => module.TranscriptPane,
    { ...props, dialogKey },
  );
  return elements(h.render(), "TranscriptLine").map((row) => row.props);
}
function changedRows(before, after) {
  return after.flatMap((row, i) =>
    Object.keys(row).some((key) => !Object.is(row[key], before[i][key])) ? [i] : [],
  );
}

test("opening, moving and closing the dialog changes props only on affected rows", () => {
  const closed = rows(null);
  const opened = rows("1:0");
  const moved = rows("10:3");
  assert.deepEqual(changedRows(closed, opened), [1]);
  assert.deepEqual(changedRows(opened, moved), [1, 10]);
  assert.deepEqual(changedRows(moved, rows(null)), [10]);
  assert.equal(moved[1].dialogKey, null, "line 1 must not match the line 10 key");
  assert.equal(moved[10].dialogKey, "10:3");
});

test("switching words within the same line only invalidates that row", () => {
  assert.deepEqual(changedRows(rows("2:0"), rows("2:5")), [2]);
});

test("word buttons preserve dialog accessibility state", () => {
  const tokens = [
    { text: "学习", start: 0, wordLike: true },
    { text: "中文", start: 2, wordLike: true },
  ];
  function buttons(expandedKey) {
    const h = createHarness(
      words,
      { memo: (fn) => fn, isHanText: () => true },
      (module) => module.WordSpans,
      { text: "学习中文", tokens, lineIndex: 2, expandedKey },
    );
    return elements(h.render(), "button").map((button) => button.props);
  }
  const opened = buttons("2:2");
  assert.equal(opened[0]["aria-expanded"], false);
  assert.equal(opened[0]["aria-controls"], undefined);
  assert.equal(opened[1]["aria-expanded"], true);
  assert.equal(opened[1]["aria-controls"], "dictionary-dialog");
  assert.ok(buttons(null).every((button) => button["aria-expanded"] === false));
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../src/lib/groupEpisodesByMonth.ts", import.meta.url),
  "utf8",
);
let javascript;
if (nodeModule.stripTypeScriptTypes) {
  javascript = nodeModule.stripTypeScriptTypes(source);
} else {
  const ts = (await import("typescript")).default;
  javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}
const groupEpisodesByMonth = new vm.Script(
  javascript.replace(/^export /gm, "") + "\ngroupEpisodesByMonth;",
).runInNewContext();

test("groups by month and year while preserving episode order", () => {
  const episodes = [
    { id: "a", publishedAt: "2026-11-20T12:00:00" },
    { id: "b", publishedAt: "2026-11-01T12:00:00" },
    { id: "c", publishedAt: "2026-10-31T12:00:00" },
    { id: "d", publishedAt: "2025-11-20T12:00:00" },
  ];
  const groups = groupEpisodesByMonth(episodes);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].episodes[0], episodes[0]);
  assert.equal(groups[0].episodes[1], episodes[1]);
  assert.equal(groups[1].episodes[0], episodes[2]);
  assert.equal(groups[2].episodes[0], episodes[3]);
  assert.match(groups[0].label, /2026/);
  assert.notEqual(groups[0].key, groups[2].key);
});

test("merges the same month across appended pages", () => {
  const groups = groupEpisodesByMonth([
    { publishedAt: "2026-11-20T12:00:00" },
    { publishedAt: "2026-11-19T12:00:00" },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].episodes.length, 2);
});

test("handles missing dates, invalid dates, and empty lists", () => {
  assert.equal(groupEpisodesByMonth([]).length, 0);
  const groups = groupEpisodesByMonth([{ publishedAt: null }, { publishedAt: "invalid" }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "Unknown date");
  assert.equal(groups[0].episodes.length, 2);
});

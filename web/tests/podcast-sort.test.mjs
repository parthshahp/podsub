import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/lib/sortPodcasts.ts", import.meta.url), "utf8");
let javascript;
if (nodeModule.stripTypeScriptTypes) {
  javascript = nodeModule.stripTypeScriptTypes(source);
} else {
  const ts = (await import("typescript")).default;
  javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}
const { sortPodcasts, isPodcastSort } = new vm.Script(
  javascript.replace(/^export /gm, "") + "\n({ sortPodcasts, isPodcastSort });",
).runInNewContext();

const podcasts = [
  {
    id: "a",
    title: "Show 10",
    createdAt: "2026-01-01T00:00:00Z",
    latestEpisodeAt: "2026-11-08T00:00:00Z",
  },
  {
    id: "b",
    title: "show 2",
    createdAt: "2026-02-01T00:00:00Z",
    latestEpisodeAt: "2026-10-01T00:00:00Z",
  },
  { id: "c", title: "Alpha", createdAt: "2026-03-01T00:00:00Z", latestEpisodeAt: null },
];
const ids = (sort, input = podcasts) =>
  Array.from(sortPodcasts(input, sort), (podcast) => podcast.id);

test("sorts names naturally in both directions without mutating the library", () => {
  assert.deepEqual(ids("name"), ["c", "b", "a"]);
  assert.deepEqual(ids("name-desc"), ["a", "b", "c"]);
  assert.deepEqual(
    podcasts.map((podcast) => podcast.id),
    ["a", "b", "c"],
  );
});

test("sorts by latest release with undated podcasts last in both directions", () => {
  assert.deepEqual(ids("released"), ["a", "b", "c"]);
  assert.deepEqual(ids("released-asc"), ["b", "a", "c"]);
});

test("sorts by date added in both directions", () => {
  assert.deepEqual(ids("added"), ["c", "b", "a"]);
  assert.deepEqual(ids("added-asc"), ["a", "b", "c"]);
});

test("breaks date ties by name and ID for deterministic ordering", () => {
  const tied = podcasts.map((podcast) => ({
    ...podcast,
    latestEpisodeAt: null,
    createdAt: podcasts[0].createdAt,
  }));
  assert.deepEqual(ids("added", tied), ["c", "b", "a"]);
  assert.deepEqual(ids("released", tied), ["c", "b", "a"]);
  assert.deepEqual(ids("added", [{ ...tied[0], id: "z" }, tied[0]]), ["a", "z"]);
});

test("validates URL sort choices and handles an empty library", () => {
  assert.equal(isPodcastSort("released"), true);
  for (const value of [undefined, "invalid", [], null]) assert.equal(isPodcastSort(value), false);
  assert.deepEqual(ids("added", []), []);
});

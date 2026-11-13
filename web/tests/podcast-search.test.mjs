import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import TraditionalDict from "@pinyin-pro/data/traditional";
import { addTraditionalDict, pinyin } from "pinyin-pro";
import { transformWithEsbuild } from "vite";
import { createHarness, deferred, elements, loadScript } from "./helpers/hookHarness.mjs";

const coreScript = await loadScript(
  new URL("../src/lib/podcastSearch.ts", import.meta.url),
  "createPodcastSearch, searchPodcastTitles, hasChinese",
);
const { createPodcastSearch, searchPodcastTitles, hasChinese } = coreScript.runInNewContext();
const pinyinScript = await loadScript(
  new URL("../src/lib/pinyinSearch.ts", import.meta.url),
  "searchPodcasts",
);
const { searchPodcasts } = pinyinScript.runInNewContext({
  TraditionalDict,
  addTraditionalDict,
  pinyin,
  createPodcastSearch,
});
const podcasts = [
  { id: "story", title: "故事FM" },
  { id: "music", title: "音乐时间" },
  { id: "traditional", title: "音樂時間" },
  { id: "english", title: "The Daily" },
  { id: "women", title: "女力" },
];
const ids = (query, input = podcasts) => Array.from(searchPodcasts(input, query), (p) => p.id);

test("full pinyin ignores case, whitespace, tone marks, and syllable punctuation", () => {
  for (const query of ["gushi", "gu shi", " GÙ SHÌ ", "gu-shi", "gùshì".normalize("NFD")]) {
    assert.deepEqual(ids(query), ["story"], query);
  }
  assert.deepEqual(ids("shi"), ["story", "music", "traditional"]);
  assert.deepEqual(ids("gushi fm"), ["story"]);
});

test("simplified and traditional phrases use the same context-aware pronunciation", () => {
  assert.deepEqual(ids("yin yue shi jian"), ["music", "traditional"]);
  assert.deepEqual(ids("chongqing", [{ id: "city", title: "重慶森林" }]), ["city"]);
});

test("literal Chinese and English matching, digits, and result order are preserved", () => {
  assert.deepEqual(ids("故事"), ["story"]);
  assert.deepEqual(ids("時間"), ["traditional"]);
  assert.deepEqual(ids("DAILY"), ["english"]);
  assert.deepEqual(ids("The Daily"), ["english"]);
  assert.deepEqual(ids("the daily", [{ id: "space", title: "The  Daily" }]), []);
  assert.deepEqual(ids("gushi2", [{ id: "two", title: "故事 2" }]), ["two"]);
  assert.equal(searchPodcasts(podcasts, "  "), podcasts);
  assert.deepEqual(ids("anything", []), []);
  assert.deepEqual(ids("yinyue", [...podcasts].reverse()), ["traditional", "music"]);
  assert.deepEqual(ids("gs"), []);
  assert.deepEqual(ids("story"), []);
  assert.deepEqual(ids("no such show"), []);
  assert.deepEqual(ids("'"), []);
});

test("ü and its tone-marked forms also accept keyboard-friendly v", () => {
  for (const query of ["nü", "nǚ", "NV LI", "nǚ".normalize("NFD")]) {
    assert.deepEqual(ids(query), ["women"]);
  }
});

test("aliases are cached by title, skipped for literal hits, and refreshed after renames", () => {
  const converted = [];
  const search = createPodcastSearch((title) => {
    converted.push(title);
    return title === "故事" ? "gu shi" : "yin yue";
  });
  const shows = [{ title: "故事" }, { title: "English" }];
  search(shows, "故事");
  search(shows, "");
  assert.deepEqual(converted, []);
  search(shows, "gu");
  search(shows, "gushi");
  search([{ title: "故事" }], "gushi");
  assert.deepEqual(converted, ["故事"]);
  shows[0].title = "音乐";
  assert.equal(search(shows, "gushi").length, 0);
  assert.equal(search(shows, "yinyue").length, 1);
  assert.deepEqual(converted, ["故事", "音乐"]);
});

// Stub only the dynamic module boundary; execute the real hook and matcher.
const hookUrl = new URL("../src/hooks/usePodcastSearch.ts", import.meta.url);
const { code } = await transformWithEsbuild(await readFile(hookUrl, "utf8"), hookUrl.pathname, {
  target: "es2022",
  format: "esm",
});
const hookScript = new vm.Script(
  code
    .replace(/^import .*;$/gm, "")
    .replace(/^export \{[^}]*\};?$/gm, "")
    .replace('import("../lib/pinyinSearch")', "loadPinyinModule()") +
    `
      function useTestSearch({ shows, query: initialQuery, copies }) {
        const [query, setQuery] = useState(initialQuery);
        const results = Array.from({ length: copies }, () => usePodcastSearch(shows, query));
        results.setQuery = setQuery;
        return results;
      }
      ({ useTestSearch });`,
);

function setup(query = "", shows = podcasts, copies = 1) {
  const requests = [];
  const harness = createHarness(
    hookScript,
    {
      hasChinese,
      searchPodcastTitles,
      loadPinyinModule() {
        const request = deferred();
        requests.push(request);
        return request.promise;
      },
    },
    ({ useTestSearch }) => useTestSearch,
    { query, shows, copies },
  );
  return { ...harness, requests, setQuery: (query) => harness.render().setQuery(query) };
}

test("the dictionary is not loaded for browsing, Chinese queries, or English-only libraries", () => {
  for (const [query, shows] of [
    ["", podcasts],
    ["故事", podcasts],
    ["daily", [podcasts[3]]],
  ]) {
    const h = setup(query, shows);
    assert.equal(h.render()[0].searching, false);
    assert.equal(h.requests.length, 0);
    h.cleanup();
  }
});

test("both pickers share a pending dictionary load and keep literal results visible", async () => {
  const h = setup("FM", podcasts, 2);
  const results = h.render();
  assert.equal(h.requests.length, 1);
  for (const result of results) {
    assert.equal(result.searching, true);
    assert.deepEqual(
      Array.from(result.podcasts, (p) => p.id),
      ["story"],
    );
  }
  h.setQuery("yin yue");
  h.render();
  h.requests[0].resolve({ searchPodcasts });
  for (const result of await h.flush()) {
    assert.equal(result.searching, false);
    assert.deepEqual(
      Array.from(result.podcasts, (p) => p.id),
      ["music", "traditional"],
    );
  }
  assert.equal(h.requests.length, 1);
  h.cleanup();
});

test("clearing during the initial load cannot overwrite current results", async () => {
  const h = setup("gushi");
  assert.equal(h.render()[0].searching, true);
  h.setQuery("");
  assert.equal(h.render()[0].podcasts, podcasts);
  assert.equal(h.render()[0].searching, false);
  h.requests[0].resolve({ searchPodcasts });
  assert.equal((await h.flush())[0].podcasts, podcasts);
  h.setQuery("gushi");
  h.render();
  const [result] = await h.flush();
  assert.equal(result.searching, false);
  assert.deepEqual(
    Array.from(result.podcasts, (p) => p.id),
    ["story"],
  );
  assert.equal(h.requests.length, 1);
  h.cleanup();
});

test("failed imports leave literal matching usable and allow a retry after clearing", async () => {
  const h = setup("daily");
  h.render();
  h.requests[0].reject(new Error("offline"));
  let [result] = await h.flush();
  assert.equal(result.searching, false);
  assert.match(result.error, /Pinyin search unavailable/);
  assert.deepEqual(
    Array.from(result.podcasts, (p) => p.id),
    ["english"],
  );
  h.setQuery("");
  assert.equal(h.render()[0].error, null);
  h.setQuery("gushi");
  assert.equal(h.render()[0].searching, true);
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve({ searchPodcasts });
  [result] = await h.flush();
  assert.equal(result.error, null);
  assert.deepEqual(
    Array.from(result.podcasts, (p) => p.id),
    ["story"],
  );
  h.cleanup();
});

const pickerScript = await loadScript(
  new URL("../src/components/PodcastFilter.tsx", import.meta.url),
  "PodcastFilter",
);
test("the podcast picker does not announce a false empty result while loading or on failure", () => {
  for (const state of [
    { searching: true, error: null },
    { searching: false, error: "Pinyin search unavailable." },
    { searching: false, error: null },
  ]) {
    const h = createHarness(
      pickerScript,
      { usePodcastSearch: () => ({ podcasts: [], ...state }) },
      ({ PodcastFilter }) => PodcastFilter,
      { podcasts, value: { mode: "include", ids: [] }, onChange() {} },
    );
    const tree = h.render();
    assert.equal(elements(tree, "input")[0].props["aria-busy"], state.searching);
    assert.equal(
      JSON.stringify(tree).includes("No podcasts found."),
      !state.searching && !state.error,
    );
    h.cleanup();
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const source = stripTypeScriptTypes(
  await readFile(new URL("../src/feeds/refresher.ts", import.meta.url), "utf8"),
)
  .replace(/^import[\s\S]*?;$/gm, "")
  .replace(/^export /gm, "");

test("refresh uses a bounded worker pool, isolates failures and prevents overlapping runs", async () => {
  const feeds = Array.from({ length: 7 }, (_, i) => ({ title: `Feed ${i}`, feed_url: `${i}` }));
  const waiting = [];
  let active = 0;
  let maximum = 0;
  const { refreshAllFeeds, isRefreshing } = new vm.Script(
    source + "\n({refreshAllFeeds, isRefreshing});",
  ).runInNewContext({
    listPodcastFeeds: () => feeds,
    console: { log() {}, error() {} },
    importFeed: async (url) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => waiting.push(resolve));
      active--;
      if (url === "1") throw new Error("one bad feed");
    },
  });
  const run = refreshAllFeeds("test");
  assert.equal(active, 3);
  assert.equal(isRefreshing(), true);
  assert.equal(await refreshAllFeeds("overlap"), null);
  while (waiting.length) {
    waiting.shift()();
    // Drain worker continuations, allowing them to enqueue the next feed.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
  const result = await run;
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: 6, failed: 1, total: 7 });
  assert.equal(maximum, 3);
  assert.equal(isRefreshing(), false);
});

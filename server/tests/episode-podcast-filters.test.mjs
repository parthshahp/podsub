import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import * as nodeModule from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import Database from "better-sqlite3";
import { ListEpisodesQuerySchema } from "@podsub/schemas";

// Evaluate the queries against an isolated in-memory database, never the library DB.
const source = await readFile(new URL("../src/db/queries.ts", import.meta.url), "utf8");
let stripped;
if (nodeModule.stripTypeScriptTypes) {
  stripped = nodeModule.stripTypeScriptTypes(source);
} else {
  const ts = (await import("typescript")).default;
  stripped = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}
const javascript = stripped.replace(/^import .*;$/gm, "").replace(/^export /gm, "");
const db = new Database(":memory:");
const migrations = new URL("../data/migrations/", import.meta.url);
for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
  db.exec(await readFile(new URL(file, migrations), "utf8"));
}
const { listEpisodes, listPodcasts } = new vm.Script(
  javascript + "\n({ listEpisodes, listPodcasts });",
).runInNewContext({ db });

db.exec(`
  INSERT INTO podcast (id, feed_url, title, created_at, updated_at)
  VALUES ('a', 'https://a.test', 'A', 1, 1), ('b', 'https://b.test', 'B', 1, 1), ('c', 'https://c.test', 'C', 1, 1);
  INSERT INTO podcast_episode (id, podcast_id, guid, title, audio_url, published_at, created_at, archived, position_sec)
  VALUES ('a1', 'a', 'a1', 'Matching episode', 'https://a.test/1', 4, 4, 0, 10),
         ('b1', 'b', 'b1', 'Matching episode', 'https://b.test/1', 3, 3, 0, 10),
         ('c1', 'c', 'c1', 'Other episode', 'https://c.test/1', 2, 2, 0, 0),
         ('a2', 'a', 'a2', 'Archived episode', 'https://a.test/2', 1, 1, 1, 0);
`);

test("includes multiple podcasts before pagination and counting", () => {
  const first = listEpisodes({ includePodcastIds: ["a", "b"], limit: 1, offset: 0 });
  assert.equal(first.total, 2);
  assert.equal(first.rows[0].id, "a1");
  const second = listEpisodes({ includePodcastIds: ["a", "b"], limit: 1, offset: 1 });
  assert.equal(second.total, 2);
  assert.equal(second.rows[0].id, "b1");
});

test("excludes podcasts and combines with search, progress, and archive filters", () => {
  const filtered = listEpisodes({
    excludePodcastIds: ["a"],
    q: "Matching",
    inProgressOnly: true,
    limit: 50,
    offset: 0,
  });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.rows[0].id, "b1");
  assert.equal(
    listEpisodes({ includePodcastIds: ["a"], includeArchived: true, limit: 50, offset: 0 }).total,
    2,
  );
  assert.equal(listEpisodes({ excludePodcastIds: ["a", "b", "c"], limit: 50, offset: 0 }).total, 0);
});

test("empty selections restore all podcasts; IDs are bound, not interpolated", () => {
  assert.equal(
    listEpisodes({ includePodcastIds: [], excludePodcastIds: [], limit: 50, offset: 0 }).total,
    3,
  );
  assert.equal(
    listEpisodes({ includePodcastIds: ["a') OR 1=1 --"], limit: 50, offset: 0 }).total,
    0,
  );
});

test("query validation parses and bounds podcast selections", () => {
  const query = ListEpisodesQuerySchema.parse({ includePodcastIds: "a,b", excludePodcastIds: "c" });
  assert.deepEqual(query.includePodcastIds, ["a", "b"]);
  assert.deepEqual(query.excludePodcastIds, ["c"]);
  assert.equal(
    ListEpisodesQuerySchema.safeParse({ includePodcastIds: Array(501).fill("a").join(",") })
      .success,
    false,
  );
});

test("podcast summaries expose added date and latest publication across all episodes", () => {
  db.prepare(
    "INSERT INTO podcast (id, feed_url, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run("empty", "https://empty.test", "Empty", 100, 200);
  const podcasts = listPodcasts();
  assert.equal(
    podcasts.find((podcast) => podcast.id === "a").latestEpisodeAt,
    new Date(4000).toISOString(),
  );
  const empty = podcasts.find((podcast) => podcast.id === "empty");
  assert.equal(empty.latestEpisodeAt, null);
  assert.equal(empty.createdAt, new Date(100000).toISOString());
});

test.after(() => db.close());

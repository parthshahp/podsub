import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import Database from "better-sqlite3";
import { tsImport } from "tsx/esm/api";
import { SearchTranscriptsQuerySchema, TranscriptSearchSchema } from "@podsub/schemas";

const { createTranscriptSearch, findHighlights } = await tsImport(
  "../src/db/transcript-search.ts",
  import.meta.url,
);
const { createSearchRoutes } = await tsImport("../src/routes/search.ts", import.meta.url);
const { createTranscriptReader } = await tsImport(
  "../src/db/transcript-reader.ts",
  import.meta.url,
);
const { appendWordToLine, groupWordsIntoLines } = await tsImport(
  "../src/lib/transcript-text.ts",
  import.meta.url,
);
const queriesSource = await readFile(new URL("../src/db/queries.ts", import.meta.url), "utf8");
const queryJS = stripTypeScriptTypes(queriesSource)
  .replace(/^import .*;$/gm, "")
  .replace(/^export /gm, "");
const migrationsDir = new URL("../data/migrations/", import.meta.url);
const migrations = await Promise.all(
  (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFile(new URL(name, migrationsDir), "utf8")),
);

function setup(t, options = {}) {
  const db = new Database(":memory:", options);
  db.pragma("foreign_keys = ON");
  migrations.forEach((sql) => db.exec(sql));
  t.after(() => db.close());
  db.exec(`
    INSERT INTO podcast (id, feed_url, title) VALUES ('p1', 'https://one.test', '中文故事'), ('p2', 'https://two.test', 'English');
    INSERT INTO podcast_episode (id, podcast_id, guid, title, audio_url, published_at, archived)
    VALUES ('e1', 'p1', 'e1', '学习的故事', 'https://one.test/audio', 20, 1),
           ('e2', 'p2', 'e2', 'Taking your time', 'https://two.test/audio', 10, 0);
  `);
  const store = createTranscriptSearch(db);
  const { saveTranscript, getTranscript } = new vm.Script(
    queryJS + "\n({saveTranscript, getTranscript});",
  ).runInNewContext({
    db,
    transcriptSearch: store,
    appendWordToLine,
    groupWordsIntoLines,
    createTranscriptReader,
    crypto: { randomUUID },
  });
  function source(episodeId, texts, { id = randomUUID(), model = id, updated = 100 } = {}) {
    const segments = texts.map((text, i) => ({ text, start: 100 + i * 2, end: 101 + i * 2 }));
    db.prepare(
      `INSERT INTO transcript (id, episode_id, model, segments, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, episodeId, model, JSON.stringify(segments), updated);
    return id;
  }
  const search = (q, extra = {}) =>
    store.search(SearchTranscriptsQuerySchema.parse({ q, ...extra }));
  return { db, store, source, search, saveTranscript, getTranscript };
}

test("backfills existing transcripts; matches short Chinese terms without token boundaries", (t) => {
  const { store, source, search } = setup(t);
  source("e1", ["今天", "我们", "学习", "中文。", "学习", "很有意思。"]);
  assert.equal(store.backfill(), 1);
  assert.equal(store.backfill(), 0);
  const result = search("学习");
  assert.equal(result.total, 2);
  assert.equal(search("学").total, 2);
  assert.equal(search("们学习中").total, 1);
  assert.equal(result.results[0].text, "今天我们学习中文。");
  assert.deepEqual(result.results[0].highlights, [{ start: 4, end: 6 }]);
  assert.equal(result.results[0].matchSec, 104);
  assert.equal(result.results[0].startSec, 100);
  assert.equal(result.results[0].podcastTitle, "中文故事");
  assert.equal(TranscriptSearchSchema.safeParse(result).success, true);
});

test("literal case-insensitive phrases, Unicode, and wildcard symbols are not query syntax", (t) => {
  const { store, source, search } = setup(t);
  source("e2", ["Take", "YOUR", "time.", "ÉCOLE", "100%", "a_b", "\\", "'", "<script>"]);
  store.backfill();
  assert.equal(search("take your time").total, 1);
  assert.equal(search("école").total, 1);
  for (const q of ["%", "_", "\\", "'", "<script>"]) assert.equal(search(q).total, 1, q);
  assert.equal(search("% OR 1=1 --").total, 0);
  assert.equal(search("missing").total, 0);
  assert.equal(search("   ").total, 0);
});

test("highlights all occurrences with original UTF-16 offsets, including lowercase expansions", () => {
  assert.deepEqual(findHighlights("😀学习，学习！", "学习"), [
    { start: 2, end: 4 },
    { start: 5, end: 7 },
  ]);
  assert.deepEqual(findHighlights("İ x 学习", "学习"), [{ start: 4, end: 6 }]);
  assert.deepEqual(findHighlights("İ", "i"), [{ start: 0, end: 1 }]);
  assert.deepEqual(findHighlights("anything", ""), []);
});

test("filters and paginates before returning results, including archived episodes", (t) => {
  const { store, source, search } = setup(t);
  source("e1", ["学习。", "学习。"]);
  source("e2", ["学习。"]);
  store.backfill();
  assert.equal(search("学习").total, 3);
  const first = search("学习", { limit: 1 });
  const second = search("学习", { limit: 1, offset: 1 });
  assert.equal(first.total, 3);
  assert.equal(first.results[0].passageNumber, 0);
  assert.equal(second.results[0].passageNumber, 1);
  assert.equal(search("学习", { podcastId: "p2" }).total, 1);
  assert.equal(search("学习", { podcastId: "missing" }).total, 0);
  assert.equal(search("学习", { offset: 50 }).results.length, 0);
  assert.equal(search("学习", { offset: 50 }).total, 3);
  assert.equal(search("missing", { offset: 50 }).total, 0);
});

test("normalizes Unicode when indexing, not with per-passage JavaScript calls during search", (t) => {
  const { db, store, source, search } = setup(t);
  source("e2", ["ÉCOLE", "İ", "😀学习。"]);
  store.backfill();
  assert.equal(
    db.prepare("SELECT normalized_text FROM transcript_passage").get().normalized_text,
    "école i\u0307 😀学习。",
  );
  db.function("podsub_lower", () => {
    throw new Error("must not lowercase passages at search time");
  });
  assert.equal(search("ÉCOLE").total, 1);
  const chinese = search("学习").results[0];
  assert.deepEqual(chinese.highlights, [{ start: 10, end: 12 }]);
  assert.equal(chinese.matchSec, 104);
  assert.equal(search("i\u0307").total, 1);
});

test("one matching scan supplies both the page and its exact count", (t) => {
  const statements = [];
  const { db, store, source, search } = setup(t, { verbose: (sql) => statements.push(sql) });
  source("e1", ["学习。", "学习。"]);
  source("e2", ["学习。"]);
  store.backfill();
  for (const offset of [0, 99]) {
    statements.length = 0;
    const result = search("学习", { limit: 1, offset });
    assert.equal(result.total, 3);
    const matchingQueries = statements.filter((sql) =>
      sql.includes("WITH matches AS MATERIALIZED"),
    );
    assert.equal(matchingQueries.length, 1);
    const plan = db.prepare("EXPLAIN QUERY PLAN " + matchingQueries[0]).all();
    assert.equal(plan.filter((step) => /^SCAN s\b/.test(step.detail)).length, 1);
  }
});

test("versioned backfill upgrades old normalized data and catches same-second source rewrites", (t) => {
  const { db, store, source, search } = setup(t);
  source("e1", ["旧版本。"]);
  store.backfill();
  db.exec("UPDATE transcript_passage SET normalized_text = ''");
  db.exec("UPDATE transcript_search_state SET index_version = 1");
  assert.equal(store.backfill(), 1);
  assert.equal(search("旧版本").total, 1);
  db.prepare("UPDATE transcript SET segments = ? WHERE episode_id = 'e1'").run(
    JSON.stringify([{ text: "新版本。", start: 40, end: 42 }]),
  );
  assert.equal(store.backfill(), 1);
  assert.equal(store.backfill(), 0);
  assert.equal(search("旧版本").total, 0);
  assert.equal(search("新版本").results[0].matchSec, 40);
});

test("only the active player transcript is indexed, including deterministic timestamp ties", (t) => {
  const { store, source, search, getTranscript } = setup(t);
  source("e1", ["旧版本。"], { updated: 1 });
  source("e1", ["新版本。"], { updated: 2 });
  source("e1", ["最新版本。"], { updated: 2 });
  store.backfill();
  assert.equal(search("旧版本").total, 0);
  assert.equal(search("最新版本").total, 1);
  assert.equal(getTranscript("e1").lines[0].text, "最新版本。");
});

test("saving/retranscribing updates search immediately and never accumulates passages", (t) => {
  const { db, search, saveTranscript } = setup(t);
  const word = (text) => [{ word: text, start: 42, end: 45 }];
  saveTranscript("e1", "test", null, word("旧的学习。"));
  assert.equal(search("旧的").total, 1);
  saveTranscript("e1", "test", null, word("新的故事。"));
  assert.equal(search("旧的").total, 0);
  assert.equal(search("新的").total, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM transcript_passage").get().n, 1);
});

test("index failures roll back the transcript write and its previous search data", (t) => {
  const { db, search, saveTranscript, getTranscript } = setup(t);
  saveTranscript("e1", "test", "zh", [{ word: "原文。", start: 10, end: 12 }]);
  db.exec(
    `CREATE TRIGGER reject_search BEFORE INSERT ON transcript_passage BEGIN SELECT RAISE(ABORT, 'test failure'); END`,
  );
  assert.throws(() => saveTranscript("e1", "test", "zh", [{ word: "替换。", start: 10, end: 12 }]));
  assert.equal(search("原文").total, 1);
  assert.equal(getTranscript("e1").lines[0].text, "原文。");
});

test("deleting podcasts cascades search data; rebuild is idempotent and handles empty transcripts", (t) => {
  const { db, store, source, search } = setup(t);
  source("e1", ["学习。"]);
  source("e2", []);
  store.backfill();
  store.rebuild();
  store.rebuild();
  assert.equal(search("学习").total, 1);
  assert.equal(store.backfill(), 0);
  db.exec("UPDATE transcript_search_state SET index_version = 0");
  assert.equal(store.backfill(), 2);
  db.prepare("DELETE FROM podcast WHERE id = ?").run("p1");
  assert.equal(search("学习").total, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM transcript_passage").get().n, 0);
});

test("HTTP search validates bounds and returns a typed, paginated response", async (t) => {
  const { store, source } = setup(t);
  source("e1", ["学习。"]);
  store.backfill();
  const app = createSearchRoutes(store.search);
  const response = await app.request("/transcripts?q=" + encodeURIComponent("学习"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 1);
  for (const query of [
    "limit=0",
    "limit=51",
    "offset=-1",
    "offset=100001",
    "offset=1.5",
    "q=" + "a".repeat(201),
  ]) {
    assert.equal((await app.request("/transcripts?" + query)).status, 400, query);
  }
  assert.equal((await (await app.request("/transcripts")).json()).total, 0);
});

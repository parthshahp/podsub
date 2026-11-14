import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import Database from "better-sqlite3";
import { tsImport } from "tsx/esm/api";

const { createFeedImporter } = await tsImport("../src/feeds/feed-import.ts", import.meta.url);
const { createTranscriptReader } = await tsImport(
  "../src/db/transcript-reader.ts",
  import.meta.url,
);
const migrations = new URL("../data/migrations/", import.meta.url);
const sql = await Promise.all(
  (await readdir(migrations))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFile(new URL(f, migrations), "utf8")),
);
async function script(file, result) {
  const source = stripTypeScriptTypes(await readFile(new URL(file, import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?;$/gm, "")
    .replace(/^export /gm, "");
  return new vm.Script(source + `\n(${result});`);
}
const queries = await script(
  "../src/db/queries.ts",
  "{getPodcastByFeedUrl, podcastFromRow, saveFeedValidators, upsertEpisode, upsertPodcast}",
);
const importer = await script("../src/feeds/importer.ts", "importFeed");
const url = "https://feeds.test/show";
const xml = (title = "Show") => `<?xml version="1.0"?>
  <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel><title>${title}</title><description>Show notes</description><link>https://feeds.test</link>
  <item><title>Episode</title><description>Episode notes</description>
  <enclosure url="https://audio.test/1" type="audio/mpeg" length="100"/>
  <itunes:duration>1:02</itunes:duration></item></channel></rss>`;
const response = (
  title = "Show",
  headers = { etag: '"v1"', "last-modified": "Mon, 09 Nov 2026 00:00:00 GMT" },
) => new Response(xml(title), { headers });

function setup(t) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  sql.forEach((migration) => db.exec(migration));
  t.after(() => db.close());
  const bindings = queries.runInNewContext({ db, crypto: { randomUUID }, createTranscriptReader });
  const calls = [];
  let reply = () => response();
  function createImporter() {
    return importer.runInNewContext({
      db,
      ...bindings,
      createFeedImporter: (options) =>
        createFeedImporter({
          ...options,
          fetchFeed: async (...args) => {
            calls.push(args);
            return reply();
          },
        }),
    });
  }
  return {
    db,
    calls,
    importFeed: createImporter(),
    createImporter,
    setReply: (fn) => {
      reply = fn;
    },
  };
}

test("persists validators and skips all writes/parsing on 304, including after restart", async (t) => {
  const h = setup(t);
  const first = await h.importFeed(url);
  assert.equal(first.title, "Show");
  assert.equal(h.calls[0][1].headers["If-None-Match"], undefined);
  const row = h.db.prepare("SELECT * FROM podcast_episode").get();
  assert.equal(row.duration_sec, 62);
  assert.equal(row.description, "Episode notes");
  assert.equal(row.guid, "https://audio.test/1");
  const changes = h.db.prepare("SELECT total_changes() AS n").get().n;
  h.setReply(() => new Response(null, { status: 304 }));
  const second = await h.createImporter()(url);
  assert.equal(second.id, first.id);
  assert.equal(h.calls[1][1].headers["If-None-Match"], '"v1"');
  assert.equal(h.calls[1][1].headers["If-Modified-Since"], "Mon, 09 Nov 2026 00:00:00 GMT");
  assert.equal(h.db.prepare("SELECT total_changes() AS n").get().n, changes);
});

test("changed feeds update metadata in place and replace validators", async (t) => {
  const h = setup(t);
  const original = await h.importFeed(url);
  h.db.exec("UPDATE podcast_episode SET position_sec = 12, archived = 0");
  h.setReply(() => response("Renamed", { etag: '"v2"' }));
  const updated = await h.importFeed(url);
  assert.equal(updated.id, original.id);
  assert.equal(updated.title, "Renamed");
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM podcast_episode").get().n, 1);
  assert.equal(h.db.prepare("SELECT position_sec FROM podcast_episode").get().position_sec, 12);
  assert.deepEqual(h.db.prepare("SELECT etag, last_modified FROM podcast_feed_state").get(), {
    etag: '"v2"',
    last_modified: null,
  });
});

test("parse and database failures never advance validators or partially update metadata", async (t) => {
  const h = setup(t);
  await h.importFeed(url);
  h.setReply(() => new Response("invalid XML", { headers: { etag: '"bad"' } }));
  await assert.rejects(h.importFeed(url));
  h.db.exec(`CREATE TRIGGER reject_episode BEFORE UPDATE ON podcast_episode
    BEGIN SELECT RAISE(ABORT, 'write failed'); END`);
  h.setReply(() => response("Must roll back", { etag: '"v3"' }));
  await assert.rejects(h.importFeed(url), /write failed/);
  assert.equal(h.db.prepare("SELECT title FROM podcast").get().title, "Show");
  assert.equal(h.db.prepare("SELECT etag FROM podcast_feed_state").get().etag, '"v1"');
});

test("feeds without validators remain refreshable and do not duplicate guid-less episodes", async (t) => {
  const h = setup(t);
  h.setReply(() => response("Show", {}));
  await h.importFeed(url);
  await h.importFeed(url);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1][1].headers["If-None-Match"], undefined);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM podcast_episode").get().n, 1);
});

test("simultaneous manual and background imports share a single request", async (t) => {
  const h = setup(t);
  let finish;
  h.setReply(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = h.importFeed(url);
  const second = h.importFeed(url);
  assert.equal(h.calls.length, 1);
  finish(response());
  assert.equal((await first).id, (await second).id);
});

test("failed HTTP requests can be retried and unexpected 304s do not create podcasts", async (t) => {
  const h = setup(t);
  for (const status of [304, 500]) {
    h.setReply(() => new Response(null, { status }));
    await assert.rejects(h.importFeed(url), /Feed request failed/);
    assert.equal(h.db.prepare("SELECT count(*) AS n FROM podcast").get().n, 0);
  }
  h.setReply(() => response());
  await h.importFeed(url);
  h.db.exec("DELETE FROM podcast");
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM podcast_feed_state").get().n, 0);
});

test("feed downloads retain declared and streamed size caps", async (t) => {
  const h = setup(t);
  h.setReply(() => new Response("too large", { headers: { "content-length": "10485761" } }));
  await assert.rejects(h.importFeed(url), /limit/);
  h.setReply(() => new Response(new Uint8Array(10485761)));
  await assert.rejects(h.importFeed(url), /limit/);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM podcast").get().n, 0);
});

test("default feed fetching retains SSRF validation", async () => {
  const importFeed = createFeedImporter({
    getSaved() {},
    save() {
      throw new Error("must not save");
    },
  });
  await assert.rejects(importFeed("http://127.0.0.1/feed"), /Blocked/);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { tsImport } from "tsx/esm/api";
import { TranscriptSchema } from "@podsub/schemas";

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
const segments = (text) => JSON.stringify([{ text, start: 1, end: 2 }]);

function setup(t, { file = ":memory:", ...options } = {}) {
  const statements = [];
  const db = new Database(file, { verbose: (sql) => statements.push(sql) });
  db.pragma("foreign_keys = ON");
  sql.forEach((migration) => db.exec(migration));
  t.after(() => db.close());
  db.exec(`
    INSERT INTO podcast (id, feed_url, title) VALUES ('p', 'https://feed.test', 'Show');
    INSERT INTO podcast_episode (id, podcast_id, guid, title, audio_url)
    VALUES ('e1','p','1','One','https://audio.test/1'), ('e2','p','2','Two','https://audio.test/2'),
           ('e3','p','3','Three','https://audio.test/3');
  `);
  const insert = (episode, text, id = episode, updated = 1) =>
    db
      .prepare(`INSERT INTO transcript (id, episode_id, model, segments, updated_at)
      VALUES (?, ?, ?, ?, ?)`)
      .run(id, episode, id, segments(text), updated);
  return { db, insert, statements, reader: createTranscriptReader(db, options) };
}

test("warm reads reuse parsed words and derived lines without selecting the source JSON", (t) => {
  let calls = 0;
  const { reader, insert, statements } = setup(t, {
    segment(lines) {
      calls++;
      return lines;
    },
  });
  insert("e1", "Hello.");
  const first = reader.get("e1");
  assert.equal(TranscriptSchema.safeParse(first).success, true);
  statements.length = 0;
  assert.equal(reader.get("e1"), first);
  assert.equal(calls, 1);
  assert.ok(statements.some((sql) => sql.includes("SELECT id, revision")));
  assert.ok(!statements.some((sql) => sql.includes("SELECT segments")));
});

test("same-second updates, model/language changes and active-version ties invalidate the cache", (t) => {
  const { db, reader, insert } = setup(t);
  insert("e1", "Old.");
  const first = reader.get("e1");
  db.prepare(
    "UPDATE transcript SET segments = ?, model = 'changed', language = 'en' WHERE id = 'e1'",
  ).run(segments("New."));
  const updated = reader.get("e1");
  assert.notEqual(updated, first);
  assert.equal(updated.updatedAt, first.updatedAt, "timestamp alone cannot invalidate this write");
  assert.equal(updated.words[0].word, "New.");
  assert.equal(updated.model, "changed");
  insert("e1", "Tie winner.", "other");
  assert.equal(reader.get("e1").words[0].word, "Tie winner.");
});

test("deletions never return stale cached transcripts", (t) => {
  const { db, reader, insert } = setup(t);
  insert("e1", "Hello.");
  reader.get("e1");
  db.exec("DELETE FROM podcast WHERE id = 'p'");
  assert.equal(reader.get("e1"), undefined);
  assert.equal(reader.get("missing"), undefined);
});

test("cache is bounded and refreshes LRU order on hits", (t) => {
  const { reader, insert } = setup(t, { maxEntries: 2 });
  for (const id of ["e1", "e2", "e3"]) insert(id, `${id}.`);
  const first = reader.get("e1");
  const second = reader.get("e2");
  assert.equal(reader.get("e1"), first);
  reader.get("e3");
  assert.equal(reader.get("e1"), first, "recently read entry stays cached");
  assert.notEqual(reader.get("e2"), second, "least recently read entry is rebuilt");
});

test("writes from another connection are noticed without process-local invalidation", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "podsub-transcript-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "test.db");
  const { reader, insert } = setup(t, { file });
  insert("e1", "Before.");
  const before = reader.get("e1");
  const writer = new Database(file);
  try {
    writer.prepare("UPDATE transcript SET segments = ? WHERE id = 'e1'").run(segments("After."));
  } finally {
    writer.close();
  }
  assert.equal(reader.get("e1").words[0].word, "After.");
  assert.notEqual(reader.get("e1"), before);
});

test("failed updates roll back the revision and preserve the cached value", (t) => {
  const { db, reader, insert } = setup(t);
  insert("e1", "Before.");
  const before = reader.get("e1");
  assert.throws(
    db.transaction(() => {
      db.prepare("UPDATE transcript SET segments = ? WHERE id = 'e1'").run(segments("Never."));
      assert.equal(reader.get("e1").words[0].word, "Never.");
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal(reader.get("e1"), before);
  db.prepare("UPDATE transcript SET segments = ? WHERE id = 'e1'").run(segments("Committed."));
  assert.equal(reader.get("e1").words[0].word, "Committed.");
});

test("empty transcripts are cached normally and null segments do not displace a usable version", (t) => {
  const { db, reader, insert } = setup(t);
  insert("e1", "Original.");
  db.exec(`UPDATE transcript SET segments = '[]' WHERE id = 'e1'`);
  const empty = reader.get("e1");
  assert.deepEqual(empty.words, []);
  assert.deepEqual(empty.lines, []);
  assert.equal(reader.get("e1"), empty);
  db.exec(
    `INSERT INTO transcript (id, episode_id, model, updated_at) VALUES ('null', 'e1', 'null', 10)`,
  );
  assert.equal(reader.get("e1"), empty);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import Database from "better-sqlite3";
import sharp from "sharp";
import { tsImport } from "tsx/esm/api";

const { createImageCache } = await tsImport("../src/lib/image-cache.ts", import.meta.url);
const migrationsDir = new URL("../data/migrations/", import.meta.url);
const migrations = await Promise.all(
  (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFile(new URL(name, migrationsDir), "utf8")),
);
const imageUrl = "https://images.example.com/cover.png";
const original = await sharp({
  create: { width: 32, height: 32, channels: 3, background: "red" },
})
  .png()
  .toBuffer();
const response = () => new Response(original, { headers: { "content-type": "image/png" } });
const assertOptimized = async (image, width = 32, height = 32) => {
  assert.equal(image.contentType, "image/jpeg");
  const metadata = await sharp(image.data).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
  assert.equal(metadata.exif, undefined);
};
const insertPodcast = (db) =>
  db
    .prepare("INSERT INTO podcast (id, feed_url, title, image_url) VALUES (?, ?, ?, ?)")
    .run("podcast", "https://example.com/feed", "Podcast", imageUrl);
const openDatabase = (filename = ":memory:") => {
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  return db;
};
let database;
let calls;
let reply;
let cache;

beforeEach(() => {
  database = openDatabase();
  for (const migration of migrations) database.exec(migration);
  insertPodcast(database);
  calls = [];
  reply = response;
  cache = createImageCache(database, async (url) => {
    calls.push(url);
    return reply();
  });
});

afterEach(() => database.close());

test("thumbnails and card exports share optimized artwork without upscaling", async () => {
  const image = await cache.get("podcast", imageUrl);
  const thumbnail = await sharp(image.data).resize(96, 96).jpeg().toBuffer();
  assert.equal((await sharp(thumbnail).metadata()).format, "jpeg");
  reply = () => {
    throw new Error("Image host is offline");
  };
  const exported = await cache.get("podcast", imageUrl);
  await assertOptimized(exported);
  assert.deepEqual(exported.data, image.data);
  assert.deepEqual(calls, [imageUrl]);
});

test("artwork survives closing and reopening the server database", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "podsub-image-cache-"));
  const filename = path.join(directory, "podsub.db");
  let disk;
  try {
    disk = openDatabase(filename);
    for (const migration of migrations) disk.exec(migration);
    insertPodcast(disk);
    const saved = await createImageCache(disk, async () => response()).get("podcast", imageUrl);
    disk.close();
    disk = openDatabase(filename);
    const restartedCache = createImageCache(disk, async () => {
      assert.fail("Persisted artwork must not require the image host");
    });
    const restored = await restartedCache.get("podcast", imageUrl);
    await assertOptimized(restored);
    assert.deepEqual(restored.data, saved.data);
  } finally {
    if (disk?.open) disk.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("deduplicates concurrent thumbnail and export downloads", async () => {
  let release;
  reply = () => new Promise((resolve) => (release = resolve));
  const requests = [cache.get("podcast", imageUrl), cache.get("podcast", imageUrl)];
  assert.equal(calls.length, 1);
  release(response());
  const [first, second] = await Promise.all(requests);
  assert.deepEqual(first, second);
  assert.equal(database.prepare("SELECT count(*) AS count FROM podcast_image").get().count, 1);
});

test("a changed artwork URL downloads a replacement instead of returning stale bytes", async () => {
  await cache.get("podcast", imageUrl);
  const changedUrl = "https://images.example.com/new-cover.webp";
  const changedImage = await sharp({
    create: { width: 64, height: 32, channels: 3, background: "blue" },
  })
    .webp()
    .toBuffer();
  database.prepare("UPDATE podcast SET image_url = ? WHERE id = ?").run(changedUrl, "podcast");
  reply = () => new Response(changedImage, { headers: { "content-type": "image/webp" } });
  const changed = await cache.get("podcast", changedUrl);
  await assertOptimized(changed, 64, 32);
  assert.deepEqual(calls, [imageUrl, changedUrl]);
  assert.equal(database.prepare("SELECT count(*) AS count FROM podcast_image").get().count, 1);
  assert.equal(database.prepare("SELECT image_url FROM podcast_image").get().image_url, changedUrl);
});

test("failed downloads are not cached and can be retried", async () => {
  for (const failure of [
    () => new Response("unavailable", { status: 502 }),
    () => new Response("not an image", { headers: { "content-type": "text/html" } }),
    () => new Response(null, { headers: { "content-type": "image/png" } }),
    () => new Response(new Uint8Array(), { headers: { "content-type": "image/png" } }),
    () => new Response("invalid image bytes", { headers: { "content-type": "image/png" } }),
    () => {
      throw new DOMException("Timed out", "TimeoutError");
    },
  ]) {
    reply = failure;
    await assert.rejects(cache.get("podcast", imageUrl));
    assert.equal(database.prepare("SELECT count(*) AS count FROM podcast_image").get().count, 0);
  }
  reply = response;
  await assertOptimized(await cache.get("podcast", imageUrl));
});

test("rejects oversized declared and streamed images without caching partial data", async () => {
  const limit = 10 * 1024 * 1024;
  let cancelled = false;
  reply = () =>
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "image/png", "content-length": String(limit + 1) } },
    );
  await assert.rejects(cache.get("podcast", imageUrl), /exceeds limit/);
  assert.equal(cancelled, true);
  reply = () =>
    new Response(new Uint8Array(limit + 1), { headers: { "content-type": "image/png" } });
  await assert.rejects(cache.get("podcast", imageUrl), /exceeded limit/);
  assert.equal(database.prepare("SELECT count(*) AS count FROM podcast_image").get().count, 0);
  reply = response;
  await cache.get("podcast", imageUrl);
});

test("interrupted bodies never leave a partial cached image", async () => {
  reply = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(original.subarray(0, 10));
        },
        pull(controller) {
          controller.error(new Error("Connection interrupted"));
        },
      }),
      { headers: { "content-type": "image/png" } },
    );
  await assert.rejects(cache.get("podcast", imageUrl), /Connection interrupted/);
  assert.equal(database.prepare("SELECT count(*) AS count FROM podcast_image").get().count, 0);
  reply = response;
  await assertOptimized(await cache.get("podcast", imageUrl));
});

test("deleting a podcast cascades to its saved artwork", async () => {
  await cache.get("podcast", imageUrl);
  database.prepare("DELETE FROM podcast WHERE id = ?").run("podcast");
  assert.equal(database.prepare("SELECT count(*) AS count FROM podcast_image").get().count, 0);
});

test("deletion during a download cannot recreate saved artwork", async () => {
  let release;
  reply = () => new Promise((resolve) => (release = resolve));
  const pending = cache.get("podcast", imageUrl);
  database.prepare("DELETE FROM podcast WHERE id = ?").run("podcast");
  release(response());
  await pending;
  assert.equal(database.prepare("SELECT count(*) AS count FROM podcast_image").get().count, 0);
});

test("a late old-URL download cannot overwrite the current artwork", async () => {
  let release;
  reply = () => new Promise((resolve) => (release = resolve));
  const pending = cache.get("podcast", imageUrl);
  const changedUrl = "https://images.example.com/new-cover.png";
  database.prepare("UPDATE podcast SET image_url = ? WHERE id = ?").run(changedUrl, "podcast");
  reply = response;
  await cache.get("podcast", changedUrl);
  release(response());
  await pending;
  assert.equal(database.prepare("SELECT image_url FROM podcast_image").get().image_url, changedUrl);
});

test("uncached artwork still uses SSRF-safe fetching", async () => {
  const safeCache = createImageCache(database);
  await assert.rejects(safeCache.get("podcast", "http://127.0.0.1/artwork.png"), /Blocked/);
  assert.equal(database.prepare("SELECT count(*) AS count FROM podcast_image").get().count, 0);
});

test("large landscape and portrait covers fit within 1024px and keep their aspect ratio", async () => {
  for (const [width, height, expectedWidth, expectedHeight] of [
    [2400, 1200, 1024, 512],
    [1200, 2400, 512, 1024],
  ]) {
    database.prepare("DELETE FROM podcast_image").run();
    const large = await sharp({
      create: { width, height, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    reply = () => new Response(large, { headers: { "content-type": "image/png" } });
    const image = await cache.get("podcast", imageUrl);
    await assertOptimized(image, expectedWidth, expectedHeight);
    assert.ok(image.data.length < large.length);
    assert.deepEqual(database.prepare("SELECT data FROM podcast_image").get().data, image.data);
  }
});

test("honors EXIF orientation and strips the original metadata", async () => {
  const rotated = await sharp({
    create: { width: 64, height: 32, channels: 3, background: "red" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  reply = () => new Response(rotated, { headers: { "content-type": "image/jpeg" } });
  await assertOptimized(await cache.get("podcast", imageUrl), 32, 64);
});

test("transparent artwork gets a white background in JPEG exports", async () => {
  const transparent = await sharp({
    create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  reply = () => new Response(transparent, { headers: { "content-type": "image/png" } });
  const image = await cache.get("podcast", imageUrl);
  await assertOptimized(image);
  const { data } = await sharp(image.data).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([...data.subarray(0, 3)], [255, 255, 255]);
});

test("upgrades legacy originals locally and saves only the optimized version", async () => {
  database
    .prepare(
      "INSERT INTO podcast_image (podcast_id, image_url, content_type, data) VALUES (?, ?, ?, ?)",
    )
    .run("podcast", imageUrl, "image/png", original);
  reply = () => {
    assert.fail("Legacy artwork must be optimized without contacting the image host");
  };
  const [first, second] = await Promise.all([
    cache.get("podcast", imageUrl),
    cache.get("podcast", imageUrl),
  ]);
  await assertOptimized(first);
  assert.deepEqual(second.data, first.data);
  const saved = database.prepare("SELECT * FROM podcast_image").get();
  assert.equal(saved.content_type, "image/jpeg");
  assert.equal(saved.encoding_version, 1);
  assert.deepEqual(saved.data, first.data);
  assert.deepEqual((await cache.get("podcast", imageUrl)).data, first.data);
  assert.deepEqual(calls, []);
});

test("rejects images over the decoded pixel limit without saving them", async () => {
  const oversized = await sharp({
    create: { width: 5001, height: 5000, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  assert.ok(oversized.length < 10 * 1024 * 1024);
  reply = () => new Response(oversized, { headers: { "content-type": "image/png" } });
  await assert.rejects(cache.get("podcast", imageUrl), /pixel limit/);
  assert.equal(database.prepare("SELECT count(*) AS count FROM podcast_image").get().count, 0);
});

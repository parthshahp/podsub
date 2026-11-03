import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";
import { tsImport } from "tsx/esm/api";

const { audioEtag, serveCachedAudio } = await tsImport(
  "../src/lib/audio-cache.ts",
  import.meta.url,
);
const { clipEtag } = await tsImport("../src/lib/audio-clip.ts", import.meta.url);

test("audio and clip validators include source identity; clips include range", () => {
  const url = "https://example.com/episode.mp3";
  const original = clipEtag(url, 100, 1000, 1, 2);
  assert.equal(original, clipEtag(url, 100, 1000, 1, 2));
  assert.notEqual(original, clipEtag(url, 101, 1000, 1, 2));
  assert.notEqual(original, clipEtag(url, 100, 1001, 1, 2));
  assert.notEqual(original, clipEtag(url + "?new", 100, 1000, 1, 2));
  assert.notEqual(original, clipEtag(url, 100, 1000, 1, 3));
  assert.notEqual(original, clipEtag(url, 100, 1000, 0, 2));
  assert.notEqual(audioEtag(url, 100, 1000), audioEtag(url, 100, 1001));
});

test("cached audio revalidates and changes its validator after source replacement", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "podsub-cache-test-"));
  try {
    const file = path.join(dir, "audio.mp3");
    await writeFile(file, "old audio");
    const episode = { id: "test-cache", audio_url: "https://example.com/audio" };
    const app = new Hono().get("/audio", (c) =>
      serveCachedAudio(c, episode, {
        file,
        mime: "audio/mpeg",
      }),
    );
    const first = await app.request("/audio");
    assert.equal(await first.text(), "old audio");
    assert.equal(first.headers.get("cache-control"), "public, no-cache");
    const etag = first.headers.get("etag");
    assert.ok(etag);
    const unchanged = await app.request("/audio", { headers: { "if-none-match": etag } });
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.headers.get("cache-control"), "public, no-cache");
    await writeFile(file, "new audio");
    await utimes(file, new Date(), new Date(Date.now() + 1000));
    const changed = await app.request("/audio", { headers: { "if-none-match": etag } });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.get("etag"), etag);
    assert.equal(await changed.text(), "new audio");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

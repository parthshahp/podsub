import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import vm from "node:vm";
import { Hono } from "hono";
import { tsImport } from "tsx/esm/api";

const { createAudioStore, AUDIO_MIME_TYPES } = await tsImport(
  "../src/lib/audio-store.ts",
  import.meta.url,
);
const source = stripTypeScriptTypes(
  await readFile(new URL("../src/lib/audio-cache.ts", import.meta.url), "utf8"),
)
  .replace(/^import .*;$/gm, "")
  .replace(/^export /gm, "");
const script = new vm.Script(
  source +
    `
  ({ensureCachedAudioFile, resolveCachedAudio, proxyUpstreamAudio, serveCachedAudio,
    retainAudio, releaseAudio, sweepAudioCache, deleteCachedAudio});`,
);
const episode = { id: "episode", audio_url: "https://audio.test/one" };
const ttl = 3600000;

async function setup(
  t,
  fetchAudio = async () =>
    new Response("0123456789", {
      headers: { "content-type": "audio/mpeg", "content-length": "10" },
    }),
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "podsub-audio-http-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const api = script.runInNewContext({
    createHash,
    createReadStream,
    readdir,
    rm,
    stat,
    path,
    Readable,
    Response,
    AUDIO_MIME_TYPES,
    AUDIO_CACHE_TTL_MS: ttl,
    PODCASTS_DIR: directory,
    console: { error() {} },
    createAudioStore: (options) =>
      createAudioStore({
        ...options,
        onError() {},
        fetchAudio: (...args) => {
          calls++;
          return fetchAudio(...args);
        },
      }),
  });
  const app = new Hono().get("/audio", (c) => {
    const hit = api.resolveCachedAudio(episode);
    return hit ? api.serveCachedAudio(c, episode, hit) : api.proxyUpstreamAudio(c, episode);
  });
  return { api, app, directory, calls: () => calls };
}

test("shared cached files preserve byte ranges, suffix ranges, HEAD and ETag revalidation", async (t) => {
  const h = await setup(t);
  const cold = await h.app.request("/audio");
  assert.equal(cold.status, 200);
  assert.equal(await cold.text(), "0123456789");
  await h.api.ensureCachedAudioFile(episode);
  const range = await h.app.request("/audio", { headers: { range: "bytes=2-4" } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 2-4/10");
  assert.equal(await range.text(), "234");
  const suffix = await h.app.request("/audio", { headers: { range: "bytes=-2" } });
  assert.equal(await suffix.text(), "89");
  assert.equal((await h.app.request("/audio", { headers: { range: "bytes=20-" } })).status, 416);
  const head = await h.app.request("/audio", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal(await head.text(), "");
  const notModified = await h.app.request("/audio", {
    headers: { "if-none-match": head.headers.get("etag") },
  });
  assert.equal(notModified.status, 304);
  assert.equal(h.calls(), 1);
});

test("cold HEAD succeeds and cold revalidation does not start a download", async (t) => {
  const h = await setup(t, async (_url, init) => {
    assert.equal(init.method, "HEAD");
    return new Response(null, { headers: { "content-length": "10" } });
  });
  const head = await h.app.request("/audio", { method: "HEAD" });
  assert.equal(head.status, 200);
  const response = await h.app.request("/audio", {
    headers: { "if-none-match": head.headers.get("etag") },
  });
  assert.equal(response.status, 304);
  assert.equal(h.calls(), 1);
});

test("partial upstream responses preserve range headers without warming a complete file", async (t) => {
  const h = await setup(t, async (_url, init) => {
    assert.equal(init.headers.range, "bytes=2-4");
    return new Response("234", {
      status: 206,
      headers: {
        "content-length": "3",
        "content-range": "bytes 2-4/10",
        "content-type": "audio/mpeg",
      },
    });
  });
  const response = await h.app.request("/audio", { headers: { range: "bytes=2-4" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-4/10");
  assert.equal(await response.text(), "234");
  assert.equal(h.api.resolveCachedAudio(episode), null);
});

test("upstream failures return a safe error and remain retryable", async (t) => {
  const h = await setup(t, async () => new Response("private upstream details", { status: 500 }));
  for (let i = 0; i < 2; i++) {
    const response = await h.app.request("/audio");
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Upstream audio fetch failed" });
  }
  assert.equal(h.calls(), 2);
});

test("eviction respects nested holds and deletion cleans source-versioned and legacy files", async (t) => {
  const h = await setup(t);
  await h.api.ensureCachedAudioFile(episode);
  h.api.retainAudio(episode.id);
  h.api.retainAudio(episode.id);
  h.api.releaseAudio(episode.id);
  assert.equal((await h.api.sweepAudioCache(Date.now() + ttl + 1000)).deleted.length, 0);
  h.api.releaseAudio(episode.id);
  assert.equal((await h.api.sweepAudioCache(Date.now() + ttl + 1000)).deleted.length, 1);
  await h.api.ensureCachedAudioFile(episode);
  await writeFile(path.join(h.directory, "episode.mp3"), "legacy");
  await writeFile(path.join(h.directory, "episode.mp3.123.part"), "orphan");
  await writeFile(path.join(h.directory, "another.mp3"), "unrelated");
  await h.api.deleteCachedAudio(episode.id);
  assert.deepEqual(await readdir(h.directory), ["another.mp3"]);
});

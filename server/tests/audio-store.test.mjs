import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { tsImport } from "tsx/esm/api";

const { createAudioStore } = await tsImport("../src/lib/audio-store.ts", import.meta.url);
const episode = { id: "episode", audio_url: "https://audio.test/episode" };
const audio = (text = "audio bytes", options = {}) =>
  new Response(text, { headers: { "content-type": "audio/mpeg" }, ...options });

async function setup(t, fetchAudio, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "podsub-audio-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    store: createAudioStore({ directory, fetchAudio, onError() {}, ...options }),
  };
}

test("clipping and transcription share one GET, with content type from that response", async (t) => {
  const calls = [];
  const { store } = await setup(t, async (...args) => {
    calls.push(args);
    return audio();
  });
  const [clip, transcript] = await Promise.all([store.ensure(episode), store.ensure(episode)]);
  assert.deepEqual(clip, transcript);
  assert.equal(await readFile(clip.file, "utf8"), "audio bytes");
  assert.equal(clip.mime, "audio/mpeg");
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0][1].method, "HEAD");
  assert.deepEqual(await store.ensure(episode), clip);
  assert.equal(calls.length, 1, "warm cache never contacts upstream");
});

test("playback starts streaming before completion while other consumers join its file", async (t) => {
  let controller;
  let calls = 0;
  const { store } = await setup(t, async () => {
    calls++;
    return audio(
      new ReadableStream({
        start(c) {
          controller = c;
        },
      }),
    );
  });
  const first = await store.open(episode);
  assert.equal(first.kind, "upstream");
  const reader = first.response.body.getReader();
  const text = new TextEncoder();
  controller.enqueue(text.encode("first"));
  assert.equal(new TextDecoder().decode((await reader.read()).value), "first");
  let finished = false;
  const file = store.ensure(episode).then((value) => {
    finished = true;
    return value;
  });
  const second = store.open(episode);
  await Promise.resolve();
  assert.equal(finished, false);
  controller.enqueue(text.encode("second"));
  controller.close();
  const hit = await file;
  assert.equal(await readFile(hit.file, "utf8"), "firstsecond");
  assert.deepEqual(await second, { kind: "cached", audio: hit });
  assert.equal(calls, 1);
  await reader.cancel();
});

test("playback joins a download already started by clipping", async (t) => {
  let finish;
  let calls = 0;
  const { store } = await setup(t, () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const file = store.ensure(episode);
  const playback = store.open(episode, { headers: { range: "bytes=1-2" } });
  finish(audio());
  assert.equal((await playback).kind, "cached");
  await file;
  assert.equal(calls, 1);
});

test("range responses pass through without publishing incomplete cache files", async (t) => {
  const calls = [];
  const { store, directory } = await setup(t, async (_url, init) => {
    calls.push(init);
    return init.headers
      ? audio("part", { status: 206, headers: { "content-range": "bytes 0-3/11" } })
      : audio();
  });
  const source = await store.open(episode, { headers: { range: "bytes=0-3" } });
  assert.equal(source.response.status, 206);
  assert.equal(await source.response.text(), "part");
  assert.equal(store.resolve(episode), null);
  await store.ensure(episode);
  assert.equal(calls.length, 2);
  assert.equal((await readdir(directory)).length, 1);
});

test("HEAD with no body is supported and does not create a cached file", async (t) => {
  const { store } = await setup(
    t,
    async () =>
      new Response(null, {
        headers: { "content-type": "audio/mp4", "content-length": "1234" },
      }),
  );
  const source = await store.open(episode, { method: "HEAD" });
  assert.equal(source.response.status, 200);
  assert.equal(source.response.headers.get("content-length"), "1234");
  assert.equal(store.resolve(episode), null);
});

test("failed downloads are shared but not cached, and can be retried", async (t) => {
  let calls = 0;
  const { store, directory } = await setup(t, async () => {
    if (++calls === 1) return new Response("failed", { status: 502 });
    return audio("retry");
  });
  const results = await Promise.allSettled([store.ensure(episode), store.ensure(episode)]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(calls, 1);
  assert.deepEqual(await readdir(directory), []);
  assert.equal(await readFile((await store.ensure(episode)).file, "utf8"), "retry");
  assert.equal(store.isActive(episode.id), false);
});

test("declared and streamed size limits reject files and remove partial downloads", async (t) => {
  for (const declared of [true, false]) {
    const { store, directory } = await setup(
      t,
      async () =>
        audio("too large", {
          headers: declared ? { "content-length": "100" } : {},
        }),
      { maxBytes: 4 },
    );
    await assert.rejects(store.ensure(episode), /limit/);
    assert.equal(store.resolve(episode), null);
    assert.deepEqual(await readdir(directory), []);
    assert.equal(store.isActive(episode.id), false);
  }
});

test("interrupted downloads never publish partial files", async (t) => {
  const { store, directory } = await setup(t, async () =>
    audio(
      new ReadableStream({
        pull(controller) {
          controller.error(new Error("disconnected"));
        },
      }),
    ),
  );
  await assert.rejects(store.ensure(episode), /disconnected/);
  assert.deepEqual(await readdir(directory), []);
});

test("enclosure changes use distinct keys and files, including concurrent requests", async (t) => {
  let calls = 0;
  const { store } = await setup(t, async (url) => {
    calls++;
    return audio(url);
  });
  const changed = { ...episode, audio_url: "https://audio.test/replacement" };
  const [old, fresh] = await Promise.all([store.ensure(episode), store.ensure(changed)]);
  assert.notEqual(old.file, fresh.file);
  assert.equal(await readFile(fresh.file, "utf8"), changed.audio_url);
  assert.equal(await readFile(old.file, "utf8"), episode.audio_url);
  assert.equal(store.resolve(changed).file, fresh.file);
  assert.equal(calls, 2);
});

test("nested and concurrent holds are reference counted for eviction", async (t) => {
  const { store } = await setup(t, async () => audio());
  store.retain(episode.id);
  store.retain(episode.id);
  store.release(episode.id);
  await store.ensure(episode);
  assert.equal(store.isActive(episode.id), true);
  store.release(episode.id);
  assert.equal(store.isActive(episode.id), false);
});

test("default downloads retain SSRF safety", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "podsub-audio-safe-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createAudioStore({ directory });
  await assert.rejects(
    store.ensure({ ...episode, audio_url: "http://127.0.0.1/audio" }),
    /Blocked/,
  );
});

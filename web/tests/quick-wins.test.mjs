import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, useEffect } from "react";
import { act, create } from "react-test-renderer";
import { components } from "./helpers/components.mjs";

const { useEpisodeList, usePlayer, EpisodeList, PlayerBar, loadPlaybackRate } = components;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const episode = (id, extra = {}) => ({
  id,
  title: `Episode ${id}`,
  audioUrl: `https://pod.test/${id}.mp3`,
  archived: false,
  positionSec: 20,
  durationSec: 100,
  hasTranscript: false,
  transcribeStatus: "idle",
  publishedAt: null,
  podcast: { id: "pod", title: "Podcast", imageUrl: null },
  ...extra,
});
const page = (...episodes) => ({ episodes, total: episodes.length });
const response = (data) => ({ ok: true, json: async () => data });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function hook(t, useHook, options = {}) {
  let value, renderer;
  function Harness() {
    const result = useHook();
    useEffect(() => {
      value = result;
    });
    return result.audioElement ?? null;
  }
  await act(() => {
    renderer = create(createElement(Harness), options);
  });
  t.after(() => act(() => renderer.unmount()));
  return {
    get value() {
      return value;
    },
    renderer,
  };
}
function api({ list, detail, transcribe = async () => {} }) {
  globalThis.podsubTest = {
    transcribe,
    api: {
      api: {
        episodes: {
          $get: list,
          ":id": { $get: detail },
        },
      },
    },
  };
}
const tick = (t, ms) => act(() => t.mock.timers.tick(ms));

test("search stays busy through the request and discards older results", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const first = deferred(),
    second = deferred();
  api({ list: ({ query }) => (query.q === "first" ? first.promise : second.promise) });
  const h = await hook(t, () => useEpisodeList({ initial: page(episode("initial")) }));
  await act(() => h.value.setQuery("first"));
  await tick(t, 250);
  assert.equal(h.value.searching, true, "still loading after debounce ends");
  await act(() => h.value.setQuery("second"));
  await tick(t, 250);
  await act(() => second.resolve(response(page(episode("second")))));
  assert.equal(h.value.searching, false);
  await act(() => first.resolve(response(page(episode("first")))));
  assert.deepEqual(
    h.value.episodes.map((e) => e.id),
    ["second"],
  );
});

test("pagination ignores duplicate clicks and responses from previous filters", async (t) => {
  const more = deferred(),
    filtered = deferred();
  let calls = 0;
  api({
    list: ({ query }) => {
      calls++;
      return query.includeArchived ? filtered.promise : more.promise;
    },
  });
  const h = await hook(t, () =>
    useEpisodeList({ initial: { episodes: [episode("initial")], total: 3 } }),
  );
  let request;
  await act(() => {
    request = h.value.loadMore();
    void h.value.loadMore();
  });
  assert.equal(calls, 1);
  await act(() => h.value.setShowArchived(true));
  assert.equal(h.value.loadingMore, false);
  await act(() => filtered.resolve(response(page(episode("filtered")))));
  await act(async () => {
    more.resolve(response(page(episode("stale"))));
    await request;
  });
  assert.deepEqual(
    h.value.episodes.map((e) => e.id),
    ["filtered"],
  );
  assert.equal(h.value.loadError, null);
});

test("a pagination failure from before a search cannot replace its results or error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const more = deferred();
  api({
    list: ({ query }) =>
      query.q ? Promise.resolve(response(page(episode("match")))) : more.promise,
  });
  const h = await hook(t, () =>
    useEpisodeList({ initial: { episodes: [episode("initial")], total: 3 } }),
  );
  let request;
  await act(() => {
    request = h.value.loadMore();
  });
  await act(() => h.value.setQuery("match"));
  await tick(t, 250);
  await act(async () => {
    more.reject(new Error("old request failed"));
    await request;
  });
  assert.deepEqual(
    h.value.episodes.map((e) => e.id),
    ["match"],
  );
  assert.equal(h.value.loadError, null);
});

test("running jobs from the loader refresh to completed and stop polling", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let calls = 0;
  const ep = episode("running", { transcribeStatus: "running" });
  api({
    detail: async () => {
      calls++;
      return response({ episode: ep, hasTranscript: true, transcribeStatus: "idle" });
    },
  });
  const h = await hook(t, () => useEpisodeList({ initial: page(ep) }));
  await tick(t, 5000);
  assert.equal(h.value.episodes[0].hasTranscript, true);
  assert.equal(h.value.episodes[0].positionSec, 20);
  assert.equal(h.value.total, 1);
  await tick(t, 15000);
  assert.equal(calls, 1);
});

test("a failed transcription clears optimistic progress, shows the cause, and allows retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let starts = 0;
  const ep = episode("failed");
  api({
    transcribe: async () => {
      starts++;
    },
    detail: async () =>
      response({
        episode: ep,
        hasTranscript: false,
        transcribeStatus: "failed",
        transcribeError: "Provider unavailable",
      }),
  });
  const h = await hook(t, () => useEpisodeList({ initial: page(ep) }));
  await act(() => h.value.downloadTranscript(ep));
  assert.equal(h.value.transcriptStartedIds.has(ep.id), true);
  await tick(t, 5000);
  assert.equal(h.value.transcriptStartedIds.has(ep.id), false);
  assert.equal(h.value.episodes[0].transcribeStatus, "failed");
  assert.match(h.value.loadError, /Provider unavailable/);
  await act(() => h.value.downloadTranscript(h.value.episodes[0]));
  assert.equal(starts, 2);
  assert.equal(h.value.loadError, null);
});

test("list errors remain visible without another page and empty results wait for search", async (t) => {
  let renderer;
  const props = {
    episodes: [],
    total: 0,
    query: "slow",
    searching: true,
    hasMore: false,
    filters: [],
    transcriptStartedIds: new Set(),
    loadError: "Archive failed",
  };
  await act(() => {
    renderer = create(createElement(EpisodeList, props));
  });
  t.after(() => act(() => renderer.unmount()));
  assert.equal(renderer.root.findByProps({ role: "alert" }).children[0], "Archive failed");
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /No episodes match/);
});

function fakeAudio() {
  return {
    src: "",
    currentTime: 0,
    duration: 100,
    error: null,
    defaultPlaybackRate: 1,
    playbackRate: 1,
    play: async () => {},
    pause() {},
    load() {
      this.error = null;
    },
  };
}
function storage(t, initial = {}) {
  const values = new Map(Object.entries(initial));
  t.mock.getter(globalThis, "localStorage", () => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }));
  return values;
}
// Node does not expose localStorage unless explicitly enabled.
Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => undefined });

test("saved speed applies on mount, changes immediately, and survives source changes", async (t) => {
  const values = storage(t, { playbackRate: "1.25" });
  const audio = fakeAudio();
  const h = await hook(t, usePlayer, { createNodeMock: () => audio });
  assert.equal(audio.playbackRate, 1.25);
  await act(() => h.value.changePlaybackRate(1.5));
  assert.equal(audio.playbackRate, 1.5);
  assert.equal(values.get("playbackRate"), "1.5");
  await act(async () => h.value.togglePlay(episode("a")));
  await act(async () => h.value.togglePlay(episode("b")));
  assert.equal(h.value.playbackRate, 1.5);
  await act(() => h.value.changePlaybackRate(99));
  assert.equal(audio.playbackRate, 1.5);
});

test("invalid or unavailable speed storage falls back to normal speed", (t) => {
  const values = storage(t, { playbackRate: "99" });
  assert.equal(loadPlaybackRate(), 1);
  values.set("playbackRate", "garbage");
  assert.equal(loadPlaybackRate(), 1);
});

test("a rejected play surfaces an error and retry reloads at the saved position", async (t) => {
  const audio = fakeAudio();
  let attempts = 0,
    loads = 0;
  audio.play = () => (++attempts === 1 ? Promise.reject(new Error("network")) : Promise.resolve());
  audio.load = () => {
    loads++;
  };
  const h = await hook(t, usePlayer, { createNodeMock: () => audio });
  await act(async () => h.value.togglePlay(episode("a")));
  assert.match(h.value.playbackError, /could not be played/);
  assert.equal(h.value.current, null);
  await act(async () => h.value.retryPlayback());
  assert.equal(loads, 1);
  assert.equal(h.value.playbackError, null);
  assert.equal(h.value.current.id, "a");
  await act(() =>
    h.renderer.root.findByType("audio").props.onLoadedMetadata({ currentTarget: audio }),
  );
  assert.equal(audio.currentTime, 20);
});

test("native audio errors stop the playing indicator and allow recovery", async (t) => {
  const audio = fakeAudio();
  const h = await hook(t, usePlayer, { createNodeMock: () => audio });
  await act(async () => h.value.togglePlay(episode("a")));
  audio.currentTime = 42;
  await act(() => h.renderer.root.findByType("audio").props.onTimeUpdate({ currentTarget: audio }));
  audio.error = { code: 2 };
  await act(() => h.renderer.root.findByType("audio").props.onError());
  assert.match(h.value.playbackError, /could not be loaded/);
  assert.equal(h.value.current, null);
  await act(async () => h.value.retryPlayback());
  await act(() =>
    h.renderer.root.findByType("audio").props.onLoadedMetadata({ currentTarget: audio }),
  );
  assert.equal(audio.currentTime, 42);
});

test("a rejected older play promise cannot stop the new episode", async (t) => {
  const audio = fakeAudio(),
    old = deferred();
  let calls = 0;
  audio.play = () => (++calls === 1 ? old.promise : Promise.resolve());
  const h = await hook(t, usePlayer, { createNodeMock: () => audio });
  await act(async () => h.value.togglePlay(episode("a")));
  await act(async () => h.value.togglePlay(episode("b")));
  await act(() => old.reject(new Error("interrupted")));
  assert.equal(h.value.current.id, "b");
  assert.equal(h.value.playbackError, null);
});

test("speed selector exposes the supported range and passes the selected rate", async (t) => {
  let selected, renderer;
  await act(() => {
    renderer = create(
      createElement(PlayerBar, {
        episode: episode("a"),
        playing: false,
        max: 100,
        playbackRate: 1,
        onPlaybackRateChange: (rate) => {
          selected = rate;
        },
        subscribeToTime: () => () => {},
        getTime: () => 0,
      }),
    );
  });
  t.after(() => act(() => renderer.unmount()));
  const select = renderer.root.findByProps({ "aria-label": "Playback speed" });
  assert.deepEqual(
    select.findAllByType("option").map((option) => option.props.value),
    [0.75, 1, 1.25, 1.5, 1.75, 2],
  );
  await act(() => select.props.onChange({ target: { value: "1.75" } }));
  assert.equal(selected, 1.75);
});

test("unavailable storage does not prevent changing playback speed", async (t) => {
  t.mock.getter(globalThis, "localStorage", () => {
    throw new Error("Storage blocked");
  });
  const audio = fakeAudio();
  const h = await hook(t, usePlayer, { createNodeMock: () => audio });
  assert.equal(h.value.playbackRate, 1);
  await act(() => h.value.changePlaybackRate(2));
  assert.equal(audio.playbackRate, 2);
});

test("transcription polling retries transient failures without overlapping requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const pending = deferred();
  let calls = 0;
  const ep = episode("running", { transcribeStatus: "running" });
  api({
    detail: () => {
      calls++;
      return calls === 1
        ? pending.promise
        : Promise.resolve(response({ episode: ep, hasTranscript: true, transcribeStatus: "idle" }));
    },
  });
  const h = await hook(t, () => useEpisodeList({ initial: page(ep) }));
  await tick(t, 10000);
  assert.equal(calls, 1);
  await act(() => pending.reject(new Error("Offline")));
  assert.equal(h.value.loadError, null);
  await tick(t, 5000);
  assert.equal(calls, 2);
  assert.equal(h.value.episodes[0].hasTranscript, true);
});

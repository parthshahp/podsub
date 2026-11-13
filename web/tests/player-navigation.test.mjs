import assert from "node:assert/strict";
import { test } from "node:test";
import { createHarness, loadScript } from "./helpers/hookHarness.mjs";

const script = await loadScript(
  new URL("../src/hooks/usePlayer.tsx", import.meta.url),
  "usePlayer",
);
const navigationScript = await loadScript(
  new URL("../src/lib/playerNavigation.ts", import.meta.url),
  "parsePlayerSearch",
);
const { parsePlayerSearch } = navigationScript.runInNewContext();
const episode = {
  id: "e1",
  audioUrl: "https://example.test/1",
  positionSec: 90,
  durationSec: 120,
  archived: false,
};

function setup() {
  const harness = createHarness(
    script,
    {
      bindMediaSession: () => () => {},
      episodeAudioUrl: (id) => `/api/episodes/${id}/audio`,
    },
    (module) => () => module.usePlayer(),
  );
  const initial = harness.render();
  const loads = [];
  const audio = {
    paused: true,
    readyState: 0,
    duration: NaN,
    currentTime: 0,
    playCalls: 0,
    pauseCalls: 0,
    rejectPlay: false,
    set src(value) {
      loads.push(value);
      this.readyState = 0;
      this.duration = NaN;
      this.currentTime = 0;
    },
    play() {
      this.playCalls++;
      if (this.rejectPlay) return Promise.reject(new Error("Autoplay blocked"));
      this.paused = false;
      initial.audioElement.props.onPlay();
      return Promise.resolve();
    },
    pause() {
      this.pauseCalls++;
      this.paused = true;
      initial.audioElement.props.onPause();
    },
  };
  initial.audioRef.current = audio;
  function metadata(duration = 120) {
    audio.duration = duration;
    audio.readyState = 1;
    harness.render().audioElement.props.onLoadedMetadata({ currentTarget: audio });
    return harness.render();
  }
  return { harness, audio, loads, metadata };
}

test("deep links accept finite nonnegative seconds, including zero, and ignore malformed input", () => {
  for (const value of [0, "0", "42.5", 42.5, 86400])
    assert.equal(parsePlayerSearch({ t: value }).t, Number(value));
  for (const value of [
    undefined,
    null,
    "",
    " ",
    -1,
    "-1",
    Infinity,
    "NaN",
    "Infinity",
    86401,
    true,
    [],
    {},
  ]) {
    assert.equal(parsePlayerSearch({ t: value }).t, undefined);
  }
});

test("search timestamp wins over resume and is deferred until metadata arrives", () => {
  const { harness, audio, metadata } = setup();
  harness.render().play(episode, 42.5);
  assert.equal(harness.render().getTime(), 42.5);
  assert.equal(audio.currentTime, 0);
  assert.equal(metadata().getTime(), 42.5);
  assert.equal(audio.currentTime, 42.5);
});

test("zero and last-five-second timestamps work, including archived episodes", () => {
  const { harness, audio, metadata } = setup();
  harness.render().play({ ...episode, archived: true }, 0);
  metadata();
  assert.equal(audio.currentTime, 0);
  harness.render().play(episode, 118);
  assert.equal(audio.currentTime, 118);
  assert.equal(audio.pauseCalls, 0);
});

test("same-episode timestamp navigation seeks without toggling or reloading audio", () => {
  const { harness, audio, metadata, loads } = setup();
  harness.render().play(episode, 20);
  metadata();
  harness.render().play(episode, 70);
  assert.equal(audio.currentTime, 70);
  assert.equal(audio.paused, false);
  assert.equal(audio.pauseCalls, 0);
  assert.equal(loads.length, 1);
  harness.render().togglePlay(episode);
  assert.equal(audio.paused, true);
  harness.render().togglePlay(episode);
  assert.equal(audio.paused, false);
  assert.equal(audio.currentTime, 70);
});

test("same-episode timestamps beyond the duration clamp both audio and UI time", () => {
  const { harness, audio, metadata } = setup();
  harness.render().play(episode, 20);
  metadata();
  harness.render().play(episode, 500);
  assert.equal(audio.currentTime, 120);
  assert.equal(harness.render().getTime(), 120);
});

test("a seek while loading replaces the pending resume rather than being overwritten", () => {
  const { harness, audio, metadata } = setup();
  harness.render().play(episode);
  harness.render().seek(30);
  metadata();
  assert.equal(audio.currentTime, 30);
});

test("ordinary navigation preserves resume behavior and clamps stale positions", () => {
  const { harness, audio, metadata } = setup();
  harness.render().play(episode);
  metadata();
  assert.equal(audio.currentTime, 90);
  harness.render().play({ ...episode, id: "e2", positionSec: 200 });
  metadata();
  assert.equal(audio.currentTime, 115);
});

test("autoplay rejection leaves the timestamp ready for a manual Play", async () => {
  const { harness, audio, metadata } = setup();
  audio.rejectPlay = true;
  harness.render().play(episode, 42);
  await harness.flush();
  assert.equal(harness.render().current, null);
  audio.rejectPlay = false;
  harness.render().togglePlay(episode);
  metadata();
  assert.equal(audio.currentTime, 42);
  assert.equal(audio.paused, false);
});

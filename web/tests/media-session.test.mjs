import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/lib/mediaSession.ts", import.meta.url), "utf8");
// Node 22.13+ can strip types directly. On older supported Node versions,
// use the project's existing TypeScript dev dependency.
let javascript;
if (nodeModule.stripTypeScriptTypes) {
  javascript = nodeModule.stripTypeScriptTypes(source);
} else {
  const ts = (await import("typescript")).default;
  javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}
const script = new vm.Script(javascript.replace(/^export /gm, "") + "\nbindMediaSession;");

class Audio extends EventTarget {
  duration = 120;
  currentTime = 30;
  playbackRate = 1;
  paused = true;
  ended = false;
  rejectPlay = false;
  play() {
    if (this.rejectPlay) return Promise.reject(new Error("Playback interrupted"));
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
}

function setup({ unsupported = [], positionSupported = true, audio = new Audio() } = {}) {
  const handlers = new Map();
  const positions = [];
  const session = {
    playbackState: "none",
    setActionHandler(action, handler) {
      if (unsupported.includes(action)) throw new Error("Unsupported action");
      if (handler) handlers.set(action, handler);
      else handlers.delete(action);
    },
  };
  if (positionSupported) session.setPositionState = (value) => positions.push(value);
  const bind = script.runInNewContext({ navigator: { mediaSession: session } });
  const seeks = [];
  const cleanup = bind(audio, (time) => { seeks.push(time); audio.currentTime = time; });
  return { audio, handlers, session, positions, seeks, cleanup };
}

test("system play/pause use native audio and mirror interruptions", async () => {
  const { audio, handlers, session } = setup();
  assert.equal(session.playbackState, "paused");
  handlers.get("play")({});
  assert.equal(audio.paused, false);
  assert.equal(session.playbackState, "playing");
  handlers.get("pause")({});
  assert.equal(audio.paused, true);
  assert.equal(session.playbackState, "paused");
  await audio.play();
  audio.pause(); // interruption or native browser control
  assert.equal(session.playbackState, "paused");
  audio.ended = true;
  audio.dispatchEvent(new Event("ended"));
  assert.equal(session.playbackState, "none");
});

test("default 10-second skips, custom offsets and seek-to clamp to episode bounds", () => {
  const { handlers, seeks } = setup();
  handlers.get("seekbackward")({});
  handlers.get("seekforward")({ seekOffset: 25 });
  handlers.get("seekto")({ seekTime: 500 });
  handlers.get("seekto")({ seekTime: -20 });
  handlers.get("seekbackward")({ seekOffset: -1 });
  handlers.get("seekforward")({ seekOffset: NaN });
  assert.deepEqual(seeks, [20, 45, 120, 0, 0, 10]);
});

test("invalid positions and unknown duration do not attempt a seek", () => {
  const { audio, handlers, seeks, positions } = setup();
  handlers.get("seekto")({});
  handlers.get("seekto")({ seekTime: NaN });
  audio.duration = Infinity;
  handlers.get("seekforward")({});
  audio.dispatchEvent(new Event("durationchange"));
  assert.deepEqual(seeks, []);
  assert.equal(positions.at(-1), undefined);
});

test("system timeline follows time, duration and playback rate changes", () => {
  const { audio, positions } = setup();
  audio.currentTime = 75;
  audio.playbackRate = 1.5;
  audio.dispatchEvent(new Event("timeupdate"));
  assert.equal(positions.at(-1).position, 75);
  assert.equal(positions.at(-1).duration, 120);
  assert.equal(positions.at(-1).playbackRate, 1.5);
  audio.duration = 60;
  audio.dispatchEvent(new Event("durationchange"));
  assert.equal(positions.at(-1).position, 60);
  audio.playbackRate = 0;
  audio.dispatchEvent(new Event("ratechange"));
  assert.equal(positions.at(-1).playbackRate, 1);
});

test("optional APIs and unsupported individual actions preserve the other controls", () => {
  const bind = script.runInNewContext({ navigator: {} });
  assert.doesNotThrow(() => bind(new Audio(), () => {})());
  const { handlers, cleanup } = setup({ unsupported: ["seekto"], positionSupported: false });
  assert.equal(handlers.has("seekto"), false);
  assert.equal(handlers.has("play"), true);
  assert.equal(handlers.has("seekforward"), true);
  assert.doesNotThrow(cleanup);
});

test("a rejected system play request leaves the session paused", async () => {
  const { audio, handlers, session } = setup();
  audio.rejectPlay = true;
  handlers.get("play")({});
  await Promise.resolve();
  assert.equal(session.playbackState, "paused");
});

test("unmount clears handlers and position, and removes audio event listeners", () => {
  const { audio, handlers, session, positions, cleanup } = setup();
  cleanup();
  assert.equal(handlers.size, 0);
  assert.equal(session.playbackState, "none");
  assert.equal(positions.at(-1), undefined);
  const count = positions.length;
  audio.paused = false;
  audio.dispatchEvent(new Event("play"));
  audio.dispatchEvent(new Event("timeupdate"));
  assert.equal(positions.length, count);
  assert.equal(session.playbackState, "none");
});

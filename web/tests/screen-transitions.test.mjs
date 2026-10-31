import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/lib/screenTransitions.ts", import.meta.url), "utf8");
const input = source.replace(/^import .*\n/, "");
const javascript = nodeModule.stripTypeScriptTypes
  ? nodeModule.stripTypeScriptTypes(input)
  : (await import("typescript")).default.transpileModule(input, {
      compilerOptions: { target: 9, module: 99 },
    }).outputText;
const script = new vm.Script(
  javascript.replace(/^export /gm, "") + "\n({ screenTransitionPlan, createScreenTransitions });",
);

function setup() {
  const state = {
    pointer: true,
    reduced: false,
    pending: false,
    visible: true,
    skipped: 0,
    styles: [],
  };
  const document = {
    activeViewTransition: {
      skipTransition() {
        state.skipped++;
      },
    },
    querySelector() {
      return state.pending;
    },
    querySelectorAll() {
      return [
        {
          getBoundingClientRect: () => ({
            width: 100,
            height: 100,
            left: 0,
            right: 100,
            top: state.visible ? 0 : -300,
            bottom: state.visible ? 100 : -200,
          }),
        },
      ];
    },
    createElement() {
      return {
        dataset: {},
        remove() {
          state.styles = state.styles.filter((x) => x !== this);
        },
      };
    },
    head: {
      append(style) {
        state.styles.push(style);
      },
    },
  };
  const api = script.runInNewContext({
    document,
    window: { matchMedia: () => ({ matches: state.reduced }), innerHeight: 844, innerWidth: 390 },
    CSS: { escape: (value) => value },
    wasPointerInput: () => state.pointer,
  });
  return { ...api, state, transitions: api.createScreenTransitions() };
}

const change = (from, to) => ({
  fromLocation: from ? { pathname: from } : undefined,
  toLocation: { pathname: to },
});

test("only drill-in routes and their return paths get transitions", () => {
  const { screenTransitionPlan: plan } = setup();
  for (const [from, to] of [
    ["/", "/show/p1"],
    ["/show/p1", "/player/e1"],
    ["/episodes", "/player/e1"],
  ]) {
    assert.equal(plan(from, to).direction, "forward");
    assert.equal(plan(to, from).direction, "back");
  }
  for (const [from, to] of [
    ["/", "/episodes"],
    ["/episodes", "/settings"],
    ["/settings", "/"],
    ["/player/e1", "/settings"],
    ["/player/e1", "/player/e2"],
    ["/", "/"],
    ["/", "/missing"],
    ["/", "/show/%"],
  ])
    assert.equal(plan(from, to), undefined);
});

test("a selected episode uses its own artwork even when shows repeat", () => {
  const { transitions, state } = setup();
  const event = change("/episodes", "/player/e2");
  transitions.beforeNavigate(event);
  assert.equal(transitions.types(event)[0], "podsub-forward");
  assert.match(state.styles[0].textContent, /data-episode-artwork="e2"/);
  assert.match(state.styles[0].textContent, /data-episode-title="e2"/);
  assert.doesNotMatch(state.styles[0].textContent, /data-podcast-artwork/);
  transitions.beforeNavigate(change("/player/e2", "/episodes"));
  assert.equal(state.styles.length, 0);
});

test("offscreen content is not turned into a shared snapshot", () => {
  const { transitions, state } = setup();
  state.visible = false;
  const event = change("/show/p1", "/player/e1");
  transitions.beforeNavigate(event);
  assert.equal(transitions.types(event)[0], "podsub-forward");
  assert.equal(state.styles[0].textContent, "");
});

test("keyboard-started navigation stays instant after a later pointer interaction", () => {
  const { transitions, state } = setup();
  state.pointer = false;
  const event = change("/", "/show/p1");
  transitions.beforeNavigate(event);
  state.pointer = true;
  assert.equal(transitions.types(event), false);
});

test("switching to keyboard during a pointer load suppresses motion", () => {
  const { transitions, state } = setup();
  const event = change("/", "/show/p1");
  transitions.beforeNavigate(event);
  state.pointer = false;
  assert.equal(transitions.types(event), false);
});

test("initial loads, reduced motion, pending placeholders and stale commits stay instant", () => {
  for (const flag of ["reduced", "pending"]) {
    const { transitions, state } = setup();
    const event = change("/", "/show/p1");
    transitions.beforeNavigate(event);
    state[flag] = true;
    assert.equal(transitions.types(event), false);
    assert.equal(state.styles.length, 0);
  }
  const { transitions } = setup();
  const event = change("/", "/show/p1");
  assert.equal(transitions.types(event), false);
  transitions.beforeNavigate(change(undefined, "/show/p1"));
  assert.equal(transitions.types(event), false);
  transitions.beforeNavigate(event);
  assert.equal(transitions.types(change("/", "/show/p2")), false);
});

test("a browser-owned back swipe skips app motion for that navigation only", () => {
  const { transitions } = setup();
  const event = change("/show/p1", "/");
  transitions.onPopState({ hasUAVisualTransition: true });
  transitions.beforeNavigate(event);
  assert.equal(transitions.types(event), false);
  transitions.beforeNavigate(event);
  assert.equal(transitions.types(event)[0], "podsub-back");
});

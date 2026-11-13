import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { transformWithEsbuild } from "vite";

// Small deterministic runner for these modules' state/effect contracts. This
// doesn't substitute for browser checks of focus, layout, or React scheduling.
export async function loadScript(url, exports) {
  const source = await readFile(url, "utf8");
  const { code } = await transformWithEsbuild(source, url.pathname, {
    target: "es2022",
    format: "esm",
    jsx: "automatic",
  });
  return new vm.Script(
    code.replace(/^import .*;$/gm, "").replace(/^export \{[^}]*\};?$/gm, "") +
      `\n({ ${exports} });`,
  );
}

export function createHarness(script, bindings, select, args = {}) {
  const slots = [];
  const effects = [];
  const timers = new Map();
  let index = 0;
  let dirty = true;
  let value;
  let nextTimer = 0;
  const changed = (a, b) =>
    !a || a.length !== b.length || a.some((dep, i) => !Object.is(dep, b[i]));
  const useState = (initial) => {
    const i = index++;
    if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial };
    return [
      slots[i].value,
      (next) => {
        const result = typeof next === "function" ? next(slots[i].value) : next;
        if (!Object.is(result, slots[i].value)) {
          slots[i].value = result;
          dirty = true;
        }
      },
    ];
  };
  const useRef = (initial) => {
    const i = index++;
    return (slots[i] ??= { current: initial });
  };
  const useCallback = (callback, deps) => {
    const i = index++;
    if (changed(slots[i]?.deps, deps)) slots[i] = { value: callback, deps };
    return slots[i].value;
  };
  const useMemo = (factory, deps) => {
    const i = index++;
    if (changed(slots[i]?.deps, deps)) slots[i] = { value: factory(), deps };
    return slots[i].value;
  };
  const useEffect = (effect, deps) => {
    const i = index++;
    if (changed(slots[i]?.deps, deps)) {
      const previous = slots[i];
      slots[i] = { deps };
      effects.push(() => {
        previous?.cleanup?.();
        slots[i].cleanup = effect();
      });
    }
  };
  const jsx = (type, props) => ({ type, props });
  const exports = script.runInNewContext({
    useState,
    useRef,
    useCallback,
    useMemo,
    useEffect,
    setTimeout: (callback, ms) => {
      const id = ++nextTimer;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    Fragment: "fragment",
    jsx,
    jsxs: jsx,
    console: { error() {} },
    ...bindings,
  });
  const render = () => {
    for (let attempts = 0; dirty; attempts++) {
      if (attempts > 30) throw new Error("Render did not settle");
      dirty = false;
      index = 0;
      value = select(exports)(args);
      effects.splice(0).forEach((effect) => effect());
    }
    return value;
  };
  return {
    render,
    async flush() {
      // Flush the fetch/json/then/catch/finally promise chains deterministically.
      for (let i = 0; i < 12; i++) {
        await Promise.resolve();
        render();
      }
      return value;
    },
    advanceTimers(ms) {
      for (const [id, timer] of timers) {
        if (timer.ms <= ms) {
          timers.delete(id);
          timer.callback();
        }
      }
      return render();
    },
    cleanup() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
  };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function elements(tree, type) {
  if (!tree || typeof tree !== "object") return [];
  const children = [tree.props?.children].flat(Infinity);
  return [
    ...(tree.type === type ? [tree] : []),
    ...children.flatMap((child) => elements(child, type)),
  ];
}

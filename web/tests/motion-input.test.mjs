import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/lib/motionInput.ts", import.meta.url), "utf8");
let javascript;
if (nodeModule.stripTypeScriptTypes) javascript = nodeModule.stripTypeScriptTypes(source);
else {
  const ts = (await import("typescript")).default;
  javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}
const script = new vm.Script(javascript.replace(/^export /gm, "") + "\nobserveMotionInput;");

function setup(initial) {
  const document = new EventTarget();
  document.documentElement = { dataset: initial ? { motionInput: initial } : {} };
  const observe = script.runInNewContext({ document });
  const cleanup = observe();
  return { document, dataset: document.documentElement.dataset, cleanup };
}

test("initial and keyboard interactions stay immediate; pointer input opts into feedback", () => {
  const { document, dataset, cleanup } = setup();
  assert.equal(dataset.motionInput, "keyboard");
  document.dispatchEvent(new Event("pointerdown"));
  assert.equal(dataset.motionInput, "pointer");
  document.dispatchEvent(new Event("keydown"));
  assert.equal(dataset.motionInput, "keyboard");
  document.dispatchEvent(new Event("pointerdown"));
  assert.equal(dataset.motionInput, "pointer");
  cleanup();
});

test("cleanup restores the prior state and removes both event listeners", () => {
  const { document, dataset, cleanup } = setup("original");
  cleanup();
  assert.equal(dataset.motionInput, "original");
  document.dispatchEvent(new Event("pointerdown"));
  document.dispatchEvent(new Event("keydown"));
  assert.equal(dataset.motionInput, "original");
});

test("cleanup removes its attribute when none existed before mounting", () => {
  const { dataset, cleanup } = setup();
  cleanup();
  assert.equal("motionInput" in dataset, false);
});

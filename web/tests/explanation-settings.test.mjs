import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { DEFAULT_EXPLANATION_MODEL, ExplanationModelSchema } from "@podsub/schemas";

const source = await readFile(
  new URL("../src/lib/explanationSettings.ts", import.meta.url),
  "utf8",
);
let stripped;
if (nodeModule.stripTypeScriptTypes) {
  stripped = nodeModule.stripTypeScriptTypes(source);
} else {
  const ts = (await import("typescript")).default;
  stripped = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}
const javascript = stripped
  .replace(/^import[\s\S]*?from "[^"]+";\n/gm, "")
  .replace(/^export /gm, "");

function settings(localStorage) {
  return new vm.Script(
    javascript + "\n({ loadExplanationModel, saveExplanationModel });",
  ).runInNewContext({ localStorage, DEFAULT_EXPLANATION_MODEL, ExplanationModelSchema });
}

test("defaults to DeepSeek and ignores outdated or invalid saved models", () => {
  for (const value of [null, "unknown/model", "", "{}"])
    assert.equal(
      settings({ getItem: () => value }).loadExplanationModel(),
      DEFAULT_EXPLANATION_MODEL,
    );
});

test("persists supported models independently of transcription settings", () => {
  const storage = new Map([["transcriptionModel", "asr-model"]]);
  const { loadExplanationModel, saveExplanationModel } = settings({
    getItem: (key) => storage.get(key),
    setItem: (key, value) => storage.set(key, value),
  });
  saveExplanationModel("qwen/qwen3.8-flash");
  assert.equal(loadExplanationModel(), "qwen/qwen3.8-flash");
  saveExplanationModel("invalid");
  assert.equal(loadExplanationModel(), "qwen/qwen3.8-flash");
  assert.equal(storage.get("transcriptionModel"), "asr-model");
});

test("blocked browser storage is non-fatal", () => {
  const { loadExplanationModel, saveExplanationModel } = settings({
    getItem() {
      throw new Error("Blocked");
    },
    setItem() {
      throw new Error("Blocked");
    },
  });
  assert.equal(loadExplanationModel(), DEFAULT_EXPLANATION_MODEL);
  assert.doesNotThrow(() => saveExplanationModel(DEFAULT_EXPLANATION_MODEL));
});

import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { tsImport } from "tsx/esm/api";
import { DEFAULT_EXPLANATION_MODEL } from "@podsub/schemas";

const { explainLine, ExplanationError } = await tsImport(
  "../src/lib/line-explanation.ts",
  import.meta.url,
);
const { createExplanationRoutes } = await tsImport(
  "../src/routes/explanations.ts",
  import.meta.url,
);
const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;
let calls;
let reply;
const explanation = {
  translation: "Take your time.",
  explanation: "A friendly way to tell someone there is no need to hurry.",
  phrases: [{ phrase: "慢慢来", meaning: "màn màn lái — take it slowly" }],
};
const input = (text, extra = {}) => ({
  model: DEFAULT_EXPLANATION_MODEL,
  text,
  before: "",
  after: "",
  ...extra,
});

beforeEach(() => {
  calls = [];
  process.env.OPENROUTER_API_KEY = "test-key-not-real";
  reply = () => Response.json({ choices: [{ message: { content: JSON.stringify(explanation) } }] });
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    return reply();
  };
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
});

test("uses the server key, constrained output, and transcript context", async () => {
  const result = await explainLine(
    input("慢慢来", { before: "Don't worry", after: "We have time" }),
  );
  assert.deepEqual(result, explanation);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].headers.Authorization, "Bearer test-key-not-real");
  assert.equal(calls[0].body.model, DEFAULT_EXPLANATION_MODEL);
  assert.equal(calls[0].body.max_tokens, 1800);
  assert.deepEqual(calls[0].body.reasoning, { enabled: false });
  assert.deepEqual(JSON.parse(calls[0].body.messages[1].content), {
    previousLine: "Don't worry",
    selectedLine: "慢慢来",
    nextLine: "We have time",
  });
});

test("deduplicates concurrent requests and caches by text, context, and model", async () => {
  const request = input("cache test");
  const results = await Promise.all([explainLine(request), explainLine(request)]);
  assert.deepEqual(results[0], results[1]);
  await explainLine(request);
  assert.equal(calls.length, 1);
  await explainLine({ ...request, before: "different context" });
  await explainLine({ ...request, model: "qwen/qwen3.8-flash" });
  assert.equal(calls.length, 3);
});

test("limits concurrent paid requests but still deduplicates an existing request", async () => {
  const releases = [];
  reply = () =>
    new Promise((resolve) =>
      releases.push(() =>
        resolve(
          Response.json({
            choices: [{ message: { content: JSON.stringify(explanation) } }],
          }),
        ),
      ),
    );
  const requests = Array.from({ length: 8 }, (_, i) => explainLine(input(`concurrent-${i}`)));
  const duplicate = explainLine(input("concurrent-0"));
  try {
    await assert.rejects(explainLine(input("too-many")), (error) => error.status === 429);
    assert.equal(calls.length, 8);
  } finally {
    releases.forEach((release) => release());
    await Promise.all([...requests, duplicate]);
  }
});

test("bounds the result cache and evicts old entries", async () => {
  await explainLine(input("evict-oldest"));
  for (let i = 0; i < 200; i++) await explainLine(input(`eviction-${i}`));
  const count = calls.length;
  await explainLine(input("eviction-199"));
  assert.equal(calls.length, count);
  await explainLine(input("evict-oldest"));
  assert.equal(calls.length, count + 1);
});

test("missing keys and upstream failures produce actionable errors and are not cached", async () => {
  delete process.env.OPENROUTER_API_KEY;
  await assert.rejects(explainLine(input("missing-key")), (error) => error.status === 503);
  assert.equal(calls.length, 0);
  process.env.OPENROUTER_API_KEY = "test";
  for (const status of [401, 402, 429, 500]) {
    reply = () => new Response("private upstream details", { status });
    await assert.rejects(explainLine(input(`failure-${status}`)), (error) => {
      assert.ok(error instanceof ExplanationError);
      assert.equal(error.status, status === 429 ? 429 : 502);
      assert.ok(!error.message.includes("private upstream details"));
      return true;
    });
  }
  reply = () => {
    throw new DOMException("Timeout", "TimeoutError");
  };
  await assert.rejects(explainLine(input("timeout")), (error) => error.status === 504);
  reply = () => {
    throw new TypeError("Network failed");
  };
  await assert.rejects(explainLine(input("network")), (error) => error.status === 502);
});

test("validates AI output, rejects truncated responses, and allows retry", async () => {
  for (const [index, content] of [
    "not json",
    "{}",
    JSON.stringify({ ...explanation, translation: "" }),
  ].entries()) {
    reply = () => Response.json({ choices: [{ message: { content } }] });
    await assert.rejects(explainLine(input(`invalid-${index}`)), (error) => error.status === 502);
  }
  reply = () =>
    Response.json({
      choices: [{ finish_reason: "length", message: { content: JSON.stringify(explanation) } }],
    });
  await assert.rejects(explainLine(input("retry")), (error) => error.status === 502);
  reply = () =>
    Response.json({
      choices: [{ message: { content: "```json\n" + JSON.stringify(explanation) + "\n```" } }],
    });
  assert.deepEqual(await explainLine(input("retry")), explanation);
});

const transcript = {
  model: "asr",
  updatedAt: new Date().toISOString(),
  words: [],
  lines: [
    { start: 0, text: "before" },
    { start: 1, text: "route-selected" },
    { start: 2, text: "after" },
  ],
};
const app = createExplanationRoutes((id) => (id === "episode" ? transcript : undefined));
const post = (body, id = "episode") =>
  app.request(`/${id}/explanation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("endpoint validates models, indices, text, stale lines, and request size before spending", async () => {
  for (const body of [
    {},
    { lineIndex: -1, text: "a" },
    { lineIndex: 0.5, text: "a" },
    { lineIndex: 1, text: "a", model: "unapproved/expensive-model" },
    { lineIndex: 1, text: "a".repeat(6001) },
  ]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.equal((await post({ lineIndex: 99, text: "a" })).status, 404);
  assert.equal((await post({ lineIndex: 1, text: "a" }, "missing")).status, 404);
  assert.equal((await post({ lineIndex: 1, text: "stale" })).status, 409);
  assert.equal((await post({ lineIndex: 1, text: "a".repeat(33000) })).status, 413);
  assert.equal(calls.length, 0);
});

test("endpoint explains a real transcript line with only its immediate context", async () => {
  const response = await post({ lineIndex: 1, text: "route-selected" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...explanation, model: DEFAULT_EXPLANATION_MODEL });
  assert.deepEqual(JSON.parse(calls[0].body.messages[1].content), {
    previousLine: "before",
    selectedLine: "route-selected",
    nextLine: "after",
  });
});

test("endpoint returns safe JSON errors for OpenRouter failures", async () => {
  reply = () => new Response("upstream failure", { status: 429 });
  const response = await post({ lineIndex: 0, text: "before" });
  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /rate-limited/);
});

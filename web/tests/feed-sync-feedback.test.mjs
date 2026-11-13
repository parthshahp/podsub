import assert from "node:assert/strict";
import { test } from "node:test";
import { createHarness, deferred, elements, loadScript } from "./helpers/hookHarness.mjs";

const script = await loadScript(
  new URL("../src/components/NavBar.tsx", import.meta.url),
  "SyncButton",
);

function setup() {
  const requests = [];
  let invalidations = 0;
  const router = {
    invalidate: async () => {
      invalidations++;
    },
  };
  const h = createHarness(
    script,
    {
      api: {
        api: {
          podcasts: {
            refresh: {
              $post() {
                const request = deferred();
                requests.push(request);
                return request.promise;
              },
            },
          },
        },
      },
      useRouter: () => router,
      SyncIcon: () => null,
    },
    (module) => module.SyncButton,
  );
  return { ...h, requests, invalidations: () => invalidations };
}
const buttons = (h) => elements(h.render(), "button");
const text = (h) => JSON.stringify(h.render());
const response = (status, summary = {}) => ({
  status,
  ok: status < 400,
  json: async () => summary,
});

test("successful feed sync gives visible feedback, clears it, and prevents duplicate requests", async () => {
  const h = setup();
  const trigger = buttons(h)[0];
  trigger.props.onClick();
  trigger.props.onClick();
  assert.equal(h.requests.length, 1);
  assert.equal(buttons(h)[0].props.disabled, true);
  h.requests[0].resolve(response(200, { total: 2, ok: 2, failed: 0 }));
  await h.flush();
  assert.equal(h.invalidations(), 1);
  assert.match(text(h), /Feeds synced/);
  h.advanceTimers(5000);
  assert.doesNotMatch(text(h), /Feeds synced/);
  h.cleanup();
});

test("network failures stay visible and Retry starts a fresh sync", async () => {
  const h = setup();
  buttons(h)[0].props.onClick();
  h.requests[0].reject(new Error("Network failed"));
  await h.flush();
  assert.match(text(h), /Check your connection/);
  h.advanceTimers(10000);
  assert.match(text(h), /Check your connection/);
  buttons(h)
    .find((button) => button.props.children === "Retry")
    .props.onClick();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(response(200, { total: 1, ok: 1, failed: 0 }));
  await h.flush();
  assert.match(text(h), /Feeds synced/);
  h.cleanup();
});

test("partial failures and already-running syncs are not reported as successes", async () => {
  for (const [status, summary, message] of [
    [200, { total: 3, ok: 2, failed: 1 }, /1 of 3 feeds could not sync/],
    [409, {}, /already running/],
    [500, {}, /Could not sync feeds/],
  ]) {
    const h = setup();
    buttons(h)[0].props.onClick();
    h.requests[0].resolve(response(status, summary));
    await h.flush();
    assert.match(text(h), message);
    assert.doesNotMatch(text(h), /Feeds synced/);
    assert.ok(buttons(h).find((button) => button.props.children === "Retry"));
    h.cleanup();
  }
});

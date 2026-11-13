import assert from "node:assert/strict";
import { test } from "node:test";
import { createHarness, deferred, loadScript } from "./helpers/hookHarness.mjs";

const script = await loadScript(
  new URL("../src/hooks/useEpisodeList.ts", import.meta.url),
  "useEpisodeList",
);
const episode = { id: "e1", title: "Episode", archived: false, positionSec: 123.5 };
const page = (episodes = [episode]) => ({ episodes, total: episodes.length });
const response = (data, ok = true) => ({ ok, json: async () => data });

function setup(initial = page()) {
  const gets = [],
    patches = [];
  const harness = createHarness(
    script,
    {
      api: {
        api: {
          episodes: {
            $get(input) {
              const request = deferred();
              gets.push({ ...request, input });
              return request.promise;
            },
            ":id": {
              archive: {
                $patch(input) {
                  const request = deferred();
                  patches.push({ ...request, input });
                  return request.promise;
                },
              },
            },
          },
        },
      },
      requestTranscription: async () => {},
    },
    (module) => module.useEpisodeList,
    { initial },
  );
  harness.render();
  return { ...harness, gets, patches };
}

test("search stays pending after debounce and until the network response settles", async () => {
  const h = setup();
  h.render().setQuery("new");
  assert.equal(h.render().searching, true);
  h.advanceTimers(250);
  assert.equal(h.gets.length, 1);
  assert.equal(h.render().searching, true);
  h.gets[0].resolve(response(page([])));
  const result = await h.flush();
  assert.equal(result.searching, false);
  assert.equal(result.total, 0);
  h.cleanup();
});

test("stale responses cannot replace current results or dismiss the search indicator", async () => {
  const h = setup();
  h.render().setQuery("old");
  h.render();
  h.advanceTimers(250);
  h.render().setQuery("new");
  h.render();
  h.advanceTimers(250);
  h.gets[0].resolve(response(page([{ ...episode, id: "old" }])));
  assert.equal((await h.flush()).searching, true);
  h.gets[1].resolve(response(page([{ ...episode, id: "new" }])));
  const result = await h.flush();
  assert.equal(result.searching, false);
  assert.equal(result.episodes[0].id, "new");
  h.cleanup();
});

test("search failures finish loading and remain visible; returning to a query fetches again", async () => {
  const h = setup();
  h.render().setQuery("term");
  h.render();
  h.advanceTimers(250);
  h.gets[0].resolve(response(page()));
  await h.flush();
  h.render().setQuery("");
  h.render();
  h.advanceTimers(250);
  h.render().setQuery("term");
  h.render();
  h.advanceTimers(250);
  assert.equal(h.render().searching, true);
  h.gets[1].resolve(response({ error: "Search unavailable. Try again." }, false));
  const result = await h.flush();
  assert.equal(result.searching, false);
  assert.match(result.loadError, /Search unavailable/);
  h.cleanup();
});

test("Undo submits the original position and refreshes the current filter selection", async () => {
  const h = setup();
  const archive = h.render().toggleArchive(episode);
  assert.equal(h.render().episodes.length, 0);
  h.patches[0].resolve(response({ ...episode, archived: true, positionSec: 0 }));
  await archive;
  assert.equal(h.render().archiveUndo.positionSec, 123.5);
  h.render().setInProgressOnly(true);
  h.render();
  h.gets[0].resolve(response(page([])));
  await h.flush();
  const undo = h.render().undoArchive();
  assert.equal(h.render().undoingArchive, true);
  assert.equal(h.patches[1].input.json.archived, false);
  assert.equal(h.patches[1].input.json.positionSec, 123.5);
  await h.render().undoArchive();
  assert.equal(h.patches.length, 2, "double activation cannot duplicate the Undo request");
  h.patches[1].resolve(response(episode));
  await undo;
  h.render();
  assert.equal(h.gets[1].input.query.inProgressOnly, "true");
  h.gets[1].resolve(response(page()));
  const result = await h.flush();
  assert.equal(result.archiveUndo, null);
  assert.equal(result.episodes[0].positionSec, 123.5);
  h.cleanup();
});

test("failed archive rolls back; failed Undo keeps the recovery action available", async () => {
  const h = setup();
  let request = h.render().toggleArchive(episode);
  h.patches[0].resolve(response({ error: "Archive failed" }, false));
  await request;
  assert.equal(h.render().episodes[0].id, episode.id);
  assert.equal(h.render().archiveUndo, null);
  request = h.render().toggleArchive(episode);
  h.patches[1].resolve(response({ ...episode, archived: true }));
  await request;
  request = h.render().undoArchive();
  h.patches[2].resolve(response({ error: "Restore failed. Try again." }, false));
  await request;
  assert.equal(h.render().archiveUndo.id, episode.id);
  assert.equal(h.render().undoingArchive, false);
  assert.match(h.render().loadError, /Restore failed/);
  h.cleanup();
});

test("Undo retains loaded pages while refreshing a deeply archived episode", async () => {
  const episodes = Array.from({ length: 100 }, (_, index) => ({ ...episode, id: `e${index}` }));
  const h = setup({ episodes: episodes.slice(0, 50), total: 100 });
  const more = h.render().loadMore();
  h.gets[0].resolve(response({ episodes: episodes.slice(50), total: 100 }));
  await more;
  const archive = h.render().toggleArchive(episodes[99]);
  h.patches[0].resolve(response({ ...episodes[99], archived: true }));
  await archive;
  assert.equal(h.render().episodes.length, 99);
  const undo = h.render().undoArchive();
  h.patches[1].resolve(response(episodes[99]));
  await undo;
  assert.equal(h.render().episodes.length, 99, "loaded rows stay present during the refresh");
  assert.deepEqual(
    h.gets.slice(1).map((request) => request.input.query.offset),
    ["0", "50"],
  );
  h.gets[1].resolve(response({ episodes: episodes.slice(0, 50), total: 100 }));
  h.gets[2].resolve(response({ episodes: episodes.slice(50), total: 100 }));
  const result = await h.flush();
  assert.equal(result.episodes.length, 100);
  assert.equal(result.episodes[99].positionSec, 123.5);
  assert.equal(result.hasMore, false);
  h.cleanup();
});

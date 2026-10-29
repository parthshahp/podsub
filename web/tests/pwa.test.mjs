import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const template = await readFile(new URL("service-worker.js", root), "utf8");
const urls = ["/offline.html", "/assets/app.js"];

function worker() {
  const handlers = {};
  const deleted = [];
  const added = [];
  let online = true;
  const cache = {
    addAll: async (entries) => added.push(...entries),
    match: async (request) => {
      const path = typeof request === "string" ? request : new URL(request.url).pathname;
      return urls.includes(path) ? new Response(`cached:${path}`) : undefined;
    },
  };
  vm.runInNewContext(template.replace("__CACHE_VERSION__", "test").replace("__PRECACHE_URLS__", JSON.stringify(urls)), {
    URL,
    self: { location: { origin: "https://podsub.test" }, addEventListener: (type, fn) => { handlers[type] = fn; } },
    caches: {
      open: async () => cache,
      keys: async () => ["podsub-static-old", "podsub-static-test", "other-app"],
      delete: async (key) => deleted.push(key),
    },
    fetch: async () => {
      if (!online) throw new Error("Offline");
      return new Response("network");
    },
  });
  return {
    handlers, deleted, added,
    offline: () => { online = false; },
    request: (path, options = {}) => {
      let response;
      handlers.fetch({
        request: { url: new URL(path, "https://podsub.test").href, method: "GET", mode: "cors", headers: new Headers(), ...options },
        respondWith: (value) => { response = value; },
      });
      return response;
    },
  };
}

test("install precaches only the build allowlist", async () => {
  const w = worker();
  let done;
  w.handlers.install({ waitUntil: (promise) => { done = promise; } });
  await done;
  assert.deepEqual(w.added, urls);
});

test("activation removes only obsolete PodSub caches", async () => {
  const w = worker();
  let done;
  w.handlers.activate({ waitUntil: (promise) => { done = promise; } });
  await done;
  assert.deepEqual(w.deleted, ["podsub-static-old"]);
});

test("deep links use the network online and offline page on connection failure", async () => {
  const w = worker();
  assert.equal(await (await w.request("/player/123", { mode: "navigate" })).text(), "network");
  w.offline();
  assert.equal(await (await w.request("/player/123?from=episodes", { mode: "navigate" })).text(), "cached:/offline.html");
});

test("static build assets remain available offline", async () => {
  const w = worker();
  w.offline();
  assert.equal(await (await w.request("/assets/app.js")).text(), "cached:/assets/app.js");
});

test("API, media, dictionary, third-party and non-GET requests bypass the worker", () => {
  const w = worker();
  for (const path of ["/api", "/api/episodes", "/api/episodes/1/audio", "/p/audio.mp3", "/zh-dict.json", "https://cdn.test/audio.mp3", "/assets/app.js?v=2"]) {
    assert.equal(w.request(path), undefined, path);
  }
  assert.equal(w.request("/api/missing", { mode: "navigate" }), undefined);
  assert.equal(w.request("/assets/app.js", { method: "POST" }), undefined);
  assert.equal(w.request("/assets/app.js", { headers: new Headers({ Range: "bytes=0-99" }) }), undefined);
});

test("registration requires production, secure context and service worker support", async () => {
  const source = await readFile(new URL("src/registerServiceWorker.ts", root), "utf8");
  for (const [prod, secure, supported] of [[false,true,true], [true,false,true], [true,true,false], [true,true,true]]) {
    let load;
    const calls = [];
    const navigator = supported ? { serviceWorker: { register: async (...args) => { calls.push(args); } } } : {};
    vm.runInNewContext(source.replace("import.meta.env.PROD", String(prod)), {
      navigator, console,
      window: { isSecureContext: secure, addEventListener: (name, fn) => { assert.equal(name, "load"); load = fn; } },
    });
    load?.();
    assert.equal(calls.length, prod && secure && supported ? 1 : 0);
    if (calls.length) {
      assert.equal(calls[0][0], "/sw.js");
      assert.equal(calls[0][1].updateViaCache, "none");
    }
  }
});

test("manifest references correctly sized PNGs", async () => {
  const manifest = JSON.parse(await readFile(new URL("public/manifest.webmanifest", root), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  for (const icon of [...manifest.icons, { src: "/icons/apple-touch-icon.png", sizes: "180x180" }]) {
    const png = await readFile(new URL(`public${icon.src}`, root));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});

test("build generates deterministic, content-versioned workers without caching data", async () => {
  const temp = await mkdtemp(join(tmpdir(), "podsub-pwa-"));
  try {
    await mkdir(join(temp, "scripts"));
    await copyFile(new URL("scripts/build-pwa.mjs", root), join(temp, "scripts/build-pwa.mjs"));
    await writeFile(join(temp, "service-worker.js"), template);
    await mkdir(join(temp, "dist/assets/nested"), { recursive: true });
    await mkdir(join(temp, "dist/icons"));
    for (const file of ["offline.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "assets/app.js", "assets/nested/chunk.js", "zh-dict.json"]) {
      await writeFile(join(temp, "dist", file), file);
    }
    let buildNumber = 0;
    const build = async () => {
      await import(`${pathToFileURL(join(temp, "scripts/build-pwa.mjs"))}?build=${buildNumber++}`);
      return readFile(join(temp, "dist/sw.js"), "utf8");
    };
    const first = await build();
    assert.equal(await build(), first);
    assert.ok(first.includes('"/assets/nested/chunk.js"'));
    assert.ok(!first.includes('"/zh-dict.json"'));
    assert.ok(!first.includes("__CACHE_VERSION__"));
    await writeFile(join(temp, "dist/assets/app.js"), "changed");
    assert.notEqual(await build(), first);
    await writeFile(join(temp, "service-worker.js"), template + "\n// worker update\n");
    const changedWorker = await build();
    assert.notEqual(changedWorker.match(/podsub-static-([a-f0-9]+)/)[1], first.match(/podsub-static-([a-f0-9]+)/)[1]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

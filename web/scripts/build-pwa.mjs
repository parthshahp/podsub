import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dist = new URL("../dist/", import.meta.url);
const template = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
// Deliberately exclude generated dictionaries and user data from the install cache.
const files = ["offline.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
for (const entry of await readdir(new URL("assets/", dist), { recursive: true, withFileTypes: true })) {
  if (entry.isFile()) {
    const absolute = `${entry.parentPath}/${entry.name}`;
    files.push(absolute.slice(fileURLToPath(dist).length));
  }
}
files.sort();
const hash = createHash("sha256").update(template);
for (const file of files) {
  hash.update(file).update(await readFile(new URL(file, dist)));
}
const source = template
  .replace("__CACHE_VERSION__", hash.digest("hex").slice(0, 16))
  .replace("__PRECACHE_URLS__", JSON.stringify(files.map((file) => `/${file}`)));
await writeFile(new URL("sw.js", dist), source);

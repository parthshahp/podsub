import { existsSync } from "node:fs";
import path from "node:path";

import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

import { WEB_DIST_DIR } from "./config.js";
import { ankiRoutes } from "./routes/anki.js";
import { podcastRoutes } from "./routes/podcasts.js";
import { episodeRoutes } from "./routes/episodes.js";

const app = new Hono()
  .route("/api/podcasts", podcastRoutes)
  .route("/api/episodes", episodeRoutes)
  .route("/api/anki", ankiRoutes);

// Serve the built SPA (web/dist) when present. In dev the Vite server owns
// the UI on :5173, so this is skipped until `pnpm build` has run.
if (existsSync(path.join(WEB_DIST_DIR, "index.html"))) {
  app.use("/*", serveStatic({ root: WEB_DIST_DIR }));
  // SPA fallback: unknown non-API paths get index.html; unknown API paths
  // stay JSON 404s instead of silently returning the app shell.
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Not found" }, 404);
    }
    const res = await serveStatic({ root: WEB_DIST_DIR, path: "index.html" })(
      c,
      async () => {},
    );
    return res ?? c.notFound();
  });
}

export default app;
export type AppType = typeof app;

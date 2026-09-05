import { Hono } from "hono";

import { podcastRoutes } from "./routes/podcasts";
import { episodeRoutes } from "./routes/episodes";

const app = new Hono().route("/api/podcasts", podcastRoutes).route("/api/episodes", episodeRoutes);

export default app;
export type AppType = typeof app;

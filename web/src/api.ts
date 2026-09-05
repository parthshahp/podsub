import { hc } from "hono/client";
import type { AppType } from "@podsub/server/app";

export const api = hc<AppType>("/");

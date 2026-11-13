import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { SearchTranscriptsQuerySchema } from "@podsub/schemas";
import type { createTranscriptSearch } from "../db/transcript-search.js";

export function createSearchRoutes(search: ReturnType<typeof createTranscriptSearch>["search"]) {
  return new Hono().get(
    "/transcripts",
    zValidator("query", SearchTranscriptsQuerySchema, (result, c) => {
      if (!result.success) {
        return c.json(
          { error: "Expected q (up to 200 characters), limit (1–50), and offset (0–100000)" },
          400,
        );
      }
    }),
    (c) => c.json(search(c.req.valid("query"))),
  );
}

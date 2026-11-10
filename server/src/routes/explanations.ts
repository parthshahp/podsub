import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { bodyLimit } from "hono/body-limit";
import { ExplainLineInputSchema, type Transcript } from "@podsub/schemas";
import { explainLine, ExplanationError } from "../lib/line-explanation.js";

export function createExplanationRoutes(
  getTranscript: (id: string) => Transcript | null | undefined,
) {
  return new Hono().post(
    "/:id/explanation",
    bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ error: "Request too large" }, 413) }),
    zValidator("json", ExplainLineInputSchema, (result, c) => {
      if (!result.success) {
        return c.json(
          { error: "Expected a valid lineIndex, text, and supported explanation model." },
          400,
        );
      }
    }),
    async (c) => {
      const { lineIndex, text, model } = c.req.valid("json");
      const transcript = getTranscript(c.req.param("id"));
      if (!transcript) return c.json({ error: "Transcript not found" }, 404);
      const line = transcript.lines[lineIndex];
      if (!line) return c.json({ error: "Transcript line not found" }, 404);
      if (line.text !== text) {
        return c.json({ error: "The transcript changed. Reload the page and try again." }, 409);
      }
      try {
        const result = await explainLine({
          model,
          text: line.text,
          before: transcript.lines[lineIndex - 1]?.text.slice(0, 2000) ?? "",
          after: transcript.lines[lineIndex + 1]?.text.slice(0, 2000) ?? "",
        });
        return c.json({ ...result, model });
      } catch (error) {
        if (error instanceof ExplanationError)
          return c.json({ error: error.message }, error.status);
        console.error("Line explanation failed:", error);
        return c.json({ error: "Could not explain this line. Please try again." }, 502);
      }
    },
  );
}

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { AnkiProxyInputSchema } from "@podsub/schemas";
import {
  ANKI_CONNECT_URL,
  ANKI_MAX_BODY_BYTES,
  ANKI_SYNC_TIMEOUT_MS,
  ANKI_TIMEOUT_MS,
} from "../config.js";

const proxyValidator = zValidator("json", AnkiProxyInputSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: "Expected body { action, version?, params? }" }, 400);
  }
});

// Same-origin AnkiConnect proxy: the browser POSTs here (no CORS involved)
// and the server forwards to ANKI_CONNECT_URL. The dial target is
// server-configured and never client-influenced, so the proxy can't be used
// as an open relay regardless of where it points.
export const ankiRoutes = new Hono().post("/", proxyValidator, async (c) => {
  const { action, version, params } = c.req.valid("json");

  let upstream: string;
  try {
    const parsed = new URL(ANKI_CONNECT_URL); // throws on unparseable input
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Blocked non-http(s) AnkiConnect URL: ${parsed.protocol}`);
    }
    upstream = ANKI_CONNECT_URL;
  } catch (err) {
    console.error("Anki proxy misconfigured:", err);
    return c.json({ error: "Anki proxy is misconfigured" }, 500);
  }

  // addNotes payloads carry base64 media; reject absurd bodies before buffering.
  const declared = Number(c.req.header("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > ANKI_MAX_BODY_BYTES) {
    return c.json({ error: "Request body too large" }, 413);
  }

  let res: Response;
  try {
    res = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, version, params }),
      signal: AbortSignal.timeout(action === "sync" ? ANKI_SYNC_TIMEOUT_MS : ANKI_TIMEOUT_MS),
    });
  } catch {
    return c.json(
      {
        error:
          "Could not reach AnkiConnect. Is Anki running with the AnkiConnect add-on installed?",
      },
      502,
    );
  }

  // Pass AnkiConnect's { result, error } envelope through untouched so the
  // client keeps its existing error handling.
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return c.json({ error: `AnkiConnect returned HTTP ${res.status}` }, 502);
  }
  return c.json(body);
});

import { serve } from "@hono/node-server";

import app from "./app.js";
import { AUDIO_CACHE_SWEEP_MS } from "./config.js";
import { sweepAudioCache } from "./lib/audio-cache.js";

async function runAudioSweep(reason: string): Promise<void> {
  try {
    const { deleted } = await sweepAudioCache();
    if (deleted.length > 0) {
      console.log(`Audio cache sweep (${reason}): deleted ${deleted.join(", ")}`);
    }
  } catch (err) {
    console.error("Audio cache sweep failed:", err);
  }
}

// Bound podcasts/ disk usage via TTL eviction; unref() so the timer never
// holds the process open.
const sweepTimer = setInterval(() => void runAudioSweep("scheduled"), AUDIO_CACHE_SWEEP_MS);
sweepTimer.unref();
// Sweep at boot too: crash-orphaned partial downloads exist then.
void runAudioSweep("startup");

serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 3000),
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);

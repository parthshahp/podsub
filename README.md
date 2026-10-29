# podsub

Podcast transcription + side-by-side transcript player.

- `server/` — Hono backend: serves audio, transcribes via OpenRouter
  (`microsoft/mai-transcribe-2` by default), caches transcripts in `podcasts/`.
  Choose MAI Transcribe 2, Qwen3 ASR 1.7B, or Voxtral Small Transcribe 3.0
  (`mistralai/voxtral-small-transcribe-3-0`) in Settings.
- `web/` — React SPA (Vite): podcast list + player with clickable transcript.

## Prerequisites

- Node.js + `pnpm`
- `ffmpeg` on your `PATH` (audio chunking and clip export shell out to it)

## Configuration

Transcription calls OpenRouter, so it needs an API key:

```
cp .env.example .env   # then set OPENROUTER_API_KEY
```

Without a key the app still runs and plays audio, but transcription
requests fail upstream.

## Development

```
pnpm install
pnpm dev
```

Open http://localhost:5173 (Vite proxies `/api` and `/p` to the backend on :3000).

## Other scripts

```
pnpm lint        # oxlint
pnpm fmt         # oxfmt
pnpm typecheck   # tsc in all packages
pnpm build       # build all packages
```

## Production (self-host)

```
pnpm install
pnpm --filter @podsub/server build:dict  # one-time dictionary build
pnpm build
PORT=3000 node server/dist/index.js
```

The backend serves the built UI itself on `:$PORT` (default 3000), so one
process is all you need — expose it on your LAN directly or put a reverse
proxy in front. Persist `server/data/` (SQLite) and `podcasts/` (audio
cache) across restarts.

## Install as an app (PWA)

The production build includes a web manifest, home-screen icons, and a service
worker. Serve it over **HTTPS** (localhost is also supported). Plain HTTP on a
LAN IP does not enable service workers or normal PWA installation.

- Chrome/Edge: use the browser’s Install app action.
- iPhone/iPad: open in Safari, then Share → Add to Home Screen.

After an online visit, opening the app without a server connection displays an
offline page with retry links. Audio, transcripts, feeds, and Anki export still
require the server; the service worker does not cache API responses, podcast
audio, or the generated dictionary. Static UI assets are precached per build.
Updates activate after all existing PodSub windows/tabs close, so a new deployment
does not reload an active player. Development (`pnpm dev`) does not register a worker.

Run `pnpm --filter @podsub/web test` for dependency-free PWA regression tests.
To check in a browser, build and serve production over HTTPS or localhost, visit
once, then reload so the worker controls the page. In DevTools → Application,
check the manifest/icons and activated worker; simulate Offline and open a player
deep link to check the fallback. Reconnect and retry. Verify audio seeking and
API writes online, and deploy a second build while playing to check that it waits
until existing windows close before activating.

## Dictionary

Chinese word-hover definitions use [CC-CEDICT](https://www.mdbg.net/chinese/dictionary)
(CC BY-SA 4.0). The generated lookup file is gitignored; build it once with:

```
pnpm --filter @podsub/server build:dict   # → web/public/zh-dict.json
```

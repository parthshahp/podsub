# podsub

Podcast transcription + side-by-side transcript player.

- `server/` — Hono backend: serves audio, transcribes via OpenRouter
  (`microsoft/mai-transcribe-2` by default), caches transcripts in `podcasts/`.
  Choose MAI Transcribe 2, Qwen3 ASR 1.7B, or Voxtral Small Transcribe 3.0
  (`mistralai/voxtral-small-transcribe-3-0`) in Settings.
- `web/` — React SPA (Vite): podcast list + player with clickable transcript.

Use the **sparkles** button beside any transcript line to translate it into English
and explain its meaning, grammar, and useful expressions (with pinyin for Chinese).
Choose the model under **Settings → AI translation & explanation**; DeepSeek V4.1
Flash is the default. This reuses `OPENROUTER_API_KEY` on the server. Only the
selected line and its immediate neighbors are sent on demand, and repeated
explanations are cached in memory (up to 200 entries, cleared on server restart).
Timestamp seeking and dictionary word lookups continue to work as before.

Podcast search and the episode-list podcast picker accept Chinese titles or full
pinyin: `gushi`, `gu shi`, and `gù shì` all find `故事`. Matching ignores case,
spacing, punctuation, and tone marks; use `ü` or `v` for the ü vowel. Simplified and
traditional titles are supported, including mixed Chinese/English names. The
pronunciation dictionary loads locally on the first Latin-letter search and
aliases are cached; no AI or external search service is used. Initials and episode
title pinyin search are not included.

## Transcript search

Open **Search** to find a literal word or phrase across saved transcripts, optionally
scoped to one podcast. Results highlight every match in a passage and link to the
player near the first matching word. Played/archived episodes are included. Search
works with even one-character Chinese queries and ignores letter case; pinyin,
fuzzy matching, simplified/traditional conversion, and phrases spanning separate
transcript passages are not included.

Search stays in SQLite: a small derived passage table reuses the original word
timestamps, without a separate search service, full-text index, or generated audio
clips. Existing transcripts are backfilled on server startup; transcription writes
replace the affected episode's search rows atomically. Only the latest transcript
version shown by the player is searchable. To rebuild the derived data manually:

```
pnpm --filter @podsub/server rebuild:search
```

Player links accept `?t=123.4` (seconds), overriding the saved resume position.
Browsers that block autoplay require pressing Play. Audio retention is unchanged:
an evicted audio file is streamed from the original host, so a searchable transcript
does not guarantee the audio will remain available upstream.

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

The server and web `build`, `typecheck`, `test`, and `dev` scripts rebuild
`@podsub/schemas` first. This also applies to filtered commands such as
`pnpm --filter @podsub/server typecheck`, so fresh checkouts and deployments with
cached `packages/schemas/dist` never check against stale shared declarations.
Use these package scripts rather than calling `tsc` directly when deploying.

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

Podcast artwork is resized to fit within 1024 × 1024 (without upscaling), encoded
as a quality-80 JPEG, and saved in SQLite on its first successful request.
Thumbnails and Anki exports reuse that optimized image, including after server
restarts, without contacting the image host again. Previously saved originals are
optimized locally on their next use. A changed artwork URL in the feed triggers a
new download; deleting the podcast also deletes its saved image. Downloads retain
the 10 MB size cap and upstream URL safety checks; decoding is limited to 25 megapixels.

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

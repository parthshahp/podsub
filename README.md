# podsub

Podcast transcription + side-by-side transcript player.

- `server/` — Hono backend: serves audio, transcribes via OpenRouter
  (`microsoft/mai-transcribe-2`), caches transcripts in `podcasts/`.
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
pnpm typecheck   # tsc in both packages
pnpm build       # build both packages
```

## Dictionary

Chinese word-hover definitions use [CC-CEDICT](https://www.mdbg.net/chinese/dictionary)
(CC BY-SA 4.0). The generated lookup file is gitignored; build it once with:

```
pnpm --filter @podsub/server build:dict   # → web/public/zh-dict.json
```

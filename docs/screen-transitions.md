# Screen transitions

Opening a podcast or its player now connects the selected artwork and episode
title across screens, with a 140 ms crossfade for the surrounding content.
Returning follows the same visual relationship. The header and tab bar stay
stable; the viewport crossfades rather than scaling a long, scrolled list.

This applies the restraint/frequency guidance in Emil Kowalski's
[animate](https://github.com/emilkowalski/skills/tree/main/skills/animate) skill
and the spatial consistency/interruption guidance in
[apple-design](https://github.com/emilkowalski/skills/tree/main/skills/apple-design).
It narrows the earlier audit's rejection of blanket route slides: only drill-in
navigation earns a short transition, and there are no full-page slides.

| Navigation | Behavior |
| --- | --- |
| Library ↔ podcast | Selected cover connects the screens. |
| Podcast ↔ player | Visible podcast cover and selected episode title connect. |
| All episodes ↔ player | Selected episode's cover/title connect, even when a show repeats in the list. |
| Library / Episodes / Settings tabs | Instant. |
| Keyboard, reduced motion, initial load, search updates, episode-to-episode | Instant. |
| Loading placeholder → loaded screen | Instant; no second transition after waiting for data. |

The implementation uses TanStack Router's native View Transitions integration,
the existing strong ease-out token, and no animation dependency. Only selected,
visible artwork/title elements receive temporary names, so offscreen headers do
not sweep in and long lists do not create dozens of cover snapshots. Real
content does not reflow per frame. The browser animates snapshot geometry.

Browsers without the native API or typed-transition support retain instant
navigation. The latter gate matters: the router bypasses its selection callback
in browsers without types, which would otherwise animate peer tabs. Input
provenance is captured before loading. A keyboard navigation can't acquire
motion because the user taps somewhere while its request is pending. A native
browser back gesture that reports `hasUAVisualTransition` owns its presentation.
New navigation skips an older app transition where `activeViewTransition` is
available; snapshots do not intercept taps in any supported browser.

Static, non-interactive loading placeholders reserve library, podcast, episode
list, and player layouts. Each loading screen exposes one accessible status;
decorative blocks are hidden from assistive technology. There is no shimmer,
loop, or artificial minimum loading delay. Router scroll restoration preserves
the list position on Back/Forward.

## Preview and checks

- [Normal-speed video](previews/screen-transitions.webm), recorded from the production
  build in Chromium with local sample data. The clip excludes the separate
  deliberately slowed interruption test.
- [Player](screenshots/screen-transitions-player.png) and
  [loading placeholder](screenshots/screen-transitions-loading.png).
- Workspace type checks, production web build, and all 25 unit tests passed.
- The production-browser suite covers 390 px, 320 px, desktop, reduced motion,
  missing API, missing typed support, and a simulated 34 px bottom safe area.
  It checks real native-transition readiness (including duplicate-name errors),
  stable viewport snapshots, missing/offscreen artwork, instant peer tabs,
  Back/Forward, exact restored list scroll, playback, interrupted navigation,
  keyboard initiation across async loading, and the slow player placeholder.
- The safe-area check explicitly substitutes CSS values; Chromium does not
  reproduce iPhone safe-area environment variables. Safari behavior, physical
  touch feel, and native edge-swipe interaction still need an installed iPhone
  PWA check.

To rerun browser checks, install Python Playwright and Chromium, build the app,
start `pnpm --filter @podsub/web preview --host 127.0.0.1 --port 4173`, and run
`python web/tests/browser/screen-transitions.py` from the repository root.
`CHROMIUM_PATH` overrides `/usr/bin/chromium`; `PREVIEW_DIR` chooses the artifact
directory. Video recording also needs Playwright's ffmpeg executable installed.
The suite mocks all data/media requests and blocks service workers.

On iPhone, open Library → a podcast → Play, then use Back/Forward. Repeat after
scrolling down a long episode list and with iOS Reduce Motion enabled. Check
that tabs respond immediately, audio starts, the home indicator stays clear,
and the transition never makes reading or navigation feel slower.

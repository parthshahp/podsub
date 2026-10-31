"""Production-browser regression checks, using only local sample data.

Build the web app and start `vite preview --host 127.0.0.1 --port 4173` first.
Requires Python Playwright and Chromium (CHROMIUM_PATH may override its path).
Set PREVIEW_DIR to save screenshots and a video; no real account is contacted.
"""

import asyncio
import io
import json
import os
from pathlib import Path
from urllib.parse import urlparse
import wave

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:4173"
OUTPUT = Path(os.environ.get("PREVIEW_DIR", "/tmp/podsub-screen-transitions"))
PODCASTS = [dict(id=f"p{i}", title=name, imageUrl="sample", feedUrl="https://example.com/feed",
                author="PodSub sample library", description="Conversations, stories, and new words to discover.",
                language="zh", guid=None, licenseUrl=None,
                createdAt="2026-10-01T00:00:00Z", updatedAt="2026-10-01T00:00:00Z")
            for i, name in enumerate(["Convo Chinese", "Culture Notes", "Everyday Stories", "Learning Together", "Weekend Conversations", "New Perspectives", "Daily Listening", "Slow Chinese"], 1)]
EPISODES = [dict(id=f"e{i}", guid=f"e{i}", title=title,
                description="A conversation about everyday life and learning Chinese.",
                audioUrl="https://example.com/audio", audioLength=None, durationSec=180,
                publishedAt="2026-10-29T00:00:00Z", episodeType="full", archived=False,
                positionSec=0, hasTranscript=True, transcribeStatus="idle", podcast=PODCASTS[0])
            for i, title in enumerate(["Finding your own pace", "Small moments, new discoveries", "A conversation worth having"] * 8, 1)]
PODCASTS[1]["imageUrl"] = None
TRANSCRIPT = dict(model="sample", updatedAt="2026-10-29T00:00:00Z", words=[],
                  lines=[dict(start=i * 4, text="今天我们一起聊聊生活，慢慢学习新的东西。") for i in range(40)])
wav = io.BytesIO()
with wave.open(wav, "wb") as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(8000)
    audio.writeframes(b"\0\0" * 8000 * 180)
AUDIO = wav.getvalue()

# Inspect native transitions even when their 140 ms duration finishes before a
# Playwright round trip. Do not replace the API with a fake animation.
INSTRUMENT = """(() => {
  window.transitions = [];
  if (document.startViewTransition) {
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = function(options) {
      const record = {types: options.types || [], ready: false, error: null, groups: [], duration: null};
      window.transitions.push(record);
      const result = start(options);
      result.ready.then(() => {
        record.ready = true;
        record.groups = document.getAnimations().map(a => a.effect?.pseudoElement).filter(Boolean);
        record.duration = getComputedStyle(document.documentElement, '::view-transition-group(screen-artwork)').animationDuration;
        record.rootAnimation = getComputedStyle(document.documentElement, '::view-transition-group(root)').animationName;
      }).catch(error => record.error = String(error));
      return result;
    };
  }
})()"""


async def fixture(route, request, controls):
    path = urlparse(request.url).path
    if path.startswith("/api/"):
        if path == controls.get("blocked_path"):
            controls["requested"].set()
            await controls["release"].wait()
        if path.endswith("/image"):
            index = int(path.split("/")[3][1:]) - 1
            color = ["#4533c8", "#cc6a43", "#326c66", "#98743b"][index % 4]
            name = PODCASTS[index]["title"]
            svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="{color}"/><circle cx="256" cy="195" r="94" fill="none" stroke="white" stroke-width="12"/><path d="M190 200v60m132-60v60" stroke="white" stroke-width="22" stroke-linecap="round"/><text x="256" y="385" text-anchor="middle" fill="white" font-size="30" font-family="sans-serif">{name}</text></svg>'
            return await route.fulfill(content_type="image/svg+xml", body=svg)
        if path.endswith("/audio"):
            return await route.fulfill(content_type="audio/wav", body=AUDIO)
        if path == "/api/podcasts":
            data = PODCASTS
        elif path.startswith("/api/podcasts/"):
            podcast = next(p for p in PODCASTS if p["id"] == path.split("/")[3])
            data = dict(podcast=podcast, episodes=EPISODES, total=len(EPISODES), limit=50, offset=0)
        elif path == "/api/episodes":
            data = dict(episodes=EPISODES, total=len(EPISODES), limit=50, offset=0)
        elif path.endswith("/transcript"):
            data = TRANSCRIPT
        elif path.endswith("/playback"):
            data = {"ok": True}
        elif path.startswith("/api/episodes/"):
            episode = next(e for e in EPISODES if e["id"] == path.split("/")[3])
            data = dict(podcast=PODCASTS[0], episode=episode, hasTranscript=True,
                        transcribeStatus="idle", transcribeError=None)
        elif path == "/api/anki":
            data = {"result": 6, "error": None}
        else:
            raise AssertionError(f"Unexpected API request: {request.method} {path}")
        return await route.fulfill(content_type="application/json", body=json.dumps(data))
    if path == "/zh-dict.json":
        return await route.fulfill(content_type="application/json", body=json.dumps({"entries": [], "simp": {}, "trad": {}}))
    assert request.url.startswith(BASE), f"Unexpected external request: {request.url}"
    return await route.continue_()


async def settled(page):
    await page.wait_for_function("!document.querySelector('[data-screen-pending]')")
    await page.wait_for_timeout(220)


async def transition_count(page):
    return await page.evaluate("window.transitions.length")


async def open_podcast(page):
    await page.locator('a[href="/convo-chinese/p1"]').first.click()
    await page.get_by_role("heading", name="Convo Chinese", exact=True).wait_for()
    await settled(page)


async def check(browser, width=390, reduced=False, unsupported=False, typed_unsupported=False, record=False, safe_bottom=0):
    context_options = dict(viewport={"width": width, "height": 844}, has_touch=width < 768,
                           is_mobile=width < 768, service_workers="block",
                           reduced_motion="reduce" if reduced else "no-preference")
    if record:
        context_options.update(record_video_dir=str(OUTPUT / "video"), record_video_size={"width": width, "height": 844})
    context = await browser.new_context(**context_options)
    if safe_bottom:
        # Chromium doesn't emulate iPhone safe-area env() values. Explicitly
        # substitute 34 px in the existing CSS calculations for a layout check.
        await context.add_init_script(f"""document.addEventListener('DOMContentLoaded', () => {{
          const style = document.createElement('style');
          style.textContent = 'body {{padding-bottom: {safe_bottom}px}} .player-viewport {{height: calc(100dvh - 4rem - {safe_bottom}px)}} #app-tabs {{padding-bottom: {safe_bottom}px}}';
          document.head.append(style);
        }});""")
    if unsupported:
        await context.add_init_script("document.startViewTransition = undefined")
    if typed_unsupported:
        await context.add_init_script("const supports = CSS.supports.bind(CSS); CSS.supports = (...args) => args[0].includes(':active-view-transition-type') ? false : supports(...args)")
    await context.add_init_script(INSTRUMENT)
    controls = {}
    await context.route("**/*", lambda route, request: fixture(route, request, controls))
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(BASE)
    await page.get_by_role("heading", name="Podcasts", exact=True).wait_for()
    assert await transition_count(page) == 0
    await open_podcast(page)
    animated = not (reduced or unsupported or typed_unsupported)
    assert await transition_count(page) == int(animated)
    await page.get_by_role("button", name="Play Finding your own pace", exact=True).first.click()
    await page.get_by_role("heading", name="Finding your own pace", exact=True).first.wait_for(state="attached")
    await settled(page)
    assert await transition_count(page) == 2 * int(animated)
    assert await page.locator("audio").count() == 1
    await page.wait_for_function("document.querySelector('audio')?.currentTime > 0")
    # Playback can be paused immediately after entry; animation never delays it.
    await page.get_by_role("button", name="Pause Finding your own pace", exact=True).click()
    assert await page.locator("audio").evaluate("audio => audio.paused")
    assert await page.locator('nav[aria-label="Main navigation"]').count() == 0
    if record:
        await page.screenshot(path=str(OUTPUT / "player.png"))
    await page.go_back()
    await page.get_by_role("heading", name="Convo Chinese", exact=True).wait_for()
    await settled(page)
    await page.go_back()
    await page.get_by_role("heading", name="Podcasts", exact=True).wait_for()
    await settled(page)
    assert await transition_count(page) == 4 * int(animated)
    await page.go_forward()
    await page.get_by_role("heading", name="Convo Chinese", exact=True).wait_for()
    await settled(page)
    await page.go_back()
    await page.get_by_role("heading", name="Podcasts", exact=True).wait_for()
    await settled(page)
    assert await transition_count(page) == 6 * int(animated)
    if width < 768:
        await page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Episodes", exact=True).click()
    else:
        await page.get_by_role("link", name="All episodes", exact=True).click()
    await page.get_by_role("heading", name="All episodes", exact=True).wait_for()
    await settled(page)
    assert await transition_count(page) == 6 * int(animated)
    # A repeated show's artwork must not produce duplicate transition names.
    await page.get_by_role("button", name="Play Finding your own pace", exact=True).first.click()
    await page.get_by_role("heading", name="Finding your own pace", exact=True).first.wait_for(state="attached")
    await settled(page)
    assert await transition_count(page) == 7 * int(animated)
    results = await page.evaluate("window.transitions")
    assert all(item["ready"] and not item["error"] for item in results), results
    if animated:
        assert all(item["duration"] == "0.14s" for item in results), results
        assert all(item["rootAnimation"] == "none" for item in results), results
        assert "screen-artwork" in str(results[-1]["groups"]), results[-1]
        assert "screen-title" in str(results[-1]["groups"]), results[-1]
    # Responsive layout remains inside the viewport.
    assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    await page.go_back()
    await page.get_by_role("heading", name="All episodes", exact=True).wait_for()
    await settled(page)
    # Restore a scrolled list when returning from the player.
    await page.evaluate("scrollTo(0, 600)")
    await page.wait_for_timeout(120)
    await page.evaluate("document.addEventListener('pointerdown', () => window.positionBeforePlay = scrollY, {once: true, capture: true})")
    await page.get_by_role("button", name="Play A conversation worth having", exact=True).nth(2).click()
    await page.get_by_role("heading", name="A conversation worth having", exact=True).first.wait_for(state="attached")
    await settled(page)
    await page.go_back()
    await page.get_by_role("heading", name="All episodes", exact=True).wait_for()
    await settled(page)
    # Capture after Playwright scrolls the chosen row into view, before activation.
    assert await page.evaluate("Math.abs(scrollY - window.positionBeforePlay) <= 1")
    # Keyboard entry bypasses motion, including a later pointer during loading.
    await page.goto(BASE)
    await page.get_by_role("heading", name="Podcasts", exact=True).wait_for()
    controls.update(blocked_path="/api/podcasts/p1", requested=asyncio.Event(), release=asyncio.Event())
    link = page.locator('a[href="/convo-chinese/p1"]').first
    await link.focus()
    await page.keyboard.press("Enter")
    await asyncio.wait_for(controls["requested"].wait(), 5)
    await page.mouse.click(5, 5)
    controls["release"].set()
    await page.get_by_role("heading", name="Convo Chinese", exact=True).wait_for()
    await settled(page)
    assert await transition_count(page) == 0
    controls.clear()
    # Slow player loading reserves the same viewport and exposes one status.
    controls.update(blocked_path="/api/episodes/e1", requested=asyncio.Event(), release=asyncio.Event())
    await page.get_by_role("button", name="Play Finding your own pace", exact=True).first.click()
    await page.locator("[data-screen-pending]").wait_for()
    assert await page.get_by_role("status").inner_text() == "Loading episode…"
    loading_bounds = await page.locator("[data-screen-pending]").bounding_box()
    assert loading_bounds["height"] == 780 - safe_bottom, loading_bounds
    if record:
        await page.screenshot(path=str(OUTPUT / "loading-player.png"))
    controls["release"].set()
    await page.get_by_role("heading", name="Finding your own pace", exact=True).first.wait_for(state="attached")
    await settled(page)
    assert await transition_count(page) == 0
    controls.clear()
    # Slow the animation only for this interruption check. A live tap on a
    # peer tab must navigate immediately while the previous snapshot is moving.
    if animated:
        await page.goto(BASE)
        await page.get_by_role("heading", name="Podcasts", exact=True).wait_for()
        await page.add_style_tag(content="html { --motion-screen-duration: 800ms; }")
        await open_podcast(page)
        if width < 768:
            await page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Settings", exact=True).click()
        else:
            await page.get_by_role("link", name="Settings", exact=True).click()
        await page.wait_for_url("**/settings")
        assert await transition_count(page) == 1
        await page.wait_for_timeout(850)
        assert urlparse(page.url).path == "/settings"
        # Headers outside the viewport must not sweep in from above a long list.
        await page.goto(BASE + "/convo-chinese/p1")
        await page.get_by_role("heading", name="Convo Chinese", exact=True).wait_for()
        await page.evaluate("scrollTo(0, 1000)")
        await page.get_by_role("button", name="Play A conversation worth having", exact=True).nth(2).click()
        await page.get_by_role("heading", name="A conversation worth having", exact=True).first.wait_for(state="attached")
        await settled(page)
        assert "screen-artwork" not in str((await page.evaluate("window.transitions"))[-1]["groups"])
        # Missing cover art retains a coherent placeholder across the transition.
        await page.goto(BASE)
        await page.get_by_role("heading", name="Podcasts", exact=True).wait_for()
        await page.locator('a[href="/culture-notes/p2"]').click()
        await page.get_by_role("heading", name="Culture Notes", exact=True).wait_for()
        await settled(page)
        assert (await page.evaluate("window.transitions"))[-1]["ready"]
    assert not errors, errors
    video = page.video
    await context.close()
    if record:
        path = await video.path()
        (OUTPUT / "screen-transitions.webm").write_bytes(Path(path).read_bytes())
    print(f"PASS width={width} reduced={reduced} unsupported={unsupported} typed_unsupported={typed_unsupported} safe_bottom={safe_bottom}", flush=True)


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"), args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        await check(browser, record=True)
        await check(browser, width=320)
        await check(browser, width=1280)
        await check(browser, reduced=True)
        await check(browser, unsupported=True)
        await check(browser, typed_unsupported=True)
        await check(browser, safe_bottom=34)
        await browser.close()


asyncio.run(main())

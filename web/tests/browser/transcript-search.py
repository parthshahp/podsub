"""Production-browser search checks with isolated fixtures (no library writes).

Build the web app and run `vite preview --host 127.0.0.1 --port 4173` first.
Requires Python Playwright; CHROMIUM_PATH may select an installed Chrome.
"""

import asyncio
import io
import json
import os
from urllib.parse import parse_qs, urlparse
import wave

from playwright.async_api import async_playwright, expect

BASE = "http://127.0.0.1:4173"
PODCAST = dict(id="p1", title="中文故事", feedUrl="https://example.test/feed", imageUrl=None,
               guid=None, description="", language="zh", author=None, licenseUrl=None,
               createdAt="2026-10-01T00:00:00Z", updatedAt="2026-10-01T00:00:00Z")
EPISODE = dict(id="e1", guid="e1", title="学习的故事", description="", audioUrl="https://example.test/audio",
               audioLength=None, durationSec=120, publishedAt="2026-10-01T00:00:00Z", episodeType="full",
               archived=False, positionSec=90, hasTranscript=True, transcribeStatus="idle")
TEXT = "今天我们学习中文，也学习写字。"
TRANSCRIPT = dict(model="sample", updatedAt="2026-10-01T00:00:00Z", words=[],
                  lines=[dict(start=i * 2, text=TEXT) for i in range(60)])
RESULTS = [dict(episodeId="e1", episodeTitle=EPISODE["title"], podcastId="p1", podcastTitle=PODCAST["title"],
                passageNumber=i, startSec=40, endSec=46, matchSec=42, text=TEXT,
                highlights=[dict(start=4, end=6), dict(start=10, end=12)]) for i in range(21)]
buffer = io.BytesIO()
with wave.open(buffer, "wb") as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(8000)
    audio.writeframes(b"\0\0" * 8000 * 120)
AUDIO = buffer.getvalue()


async def check(browser, width):
    context = await browser.new_context(viewport={"width": width, "height": 844}, service_workers="block")
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    release_audio = asyncio.Event()
    audio_requested = asyncio.Event()

    async def fixture(route, request):
        parsed = urlparse(request.url)
        path = parsed.path
        if path == "/api/search/transcripts":
            query = parse_qs(parsed.query)
            q = query.get("q", [""])[0]
            if q == "failure":
                return await route.fulfill(status=503, content_type="application/json", body=json.dumps({"error": "Search unavailable"}))
            offset = int(query.get("offset", [0])[0])
            matches = RESULTS if q == "学习" else []
            data = dict(results=matches[offset:offset + 20], total=len(matches), limit=20, offset=offset)
        elif path == "/api/podcasts":
            data = [PODCAST]
        elif path == "/api/episodes/e1":
            data = dict(podcast=PODCAST, episode=EPISODE, hasTranscript=True, transcribeStatus="idle", transcribeError=None)
        elif path == "/api/episodes/e1/transcript":
            data = TRANSCRIPT
        elif path.endswith("/audio"):
            audio_requested.set()
            await release_audio.wait()
            headers = {"accept-ranges": "bytes"}
            requested_range = request.headers.get("range")
            if requested_range:
                first, last = requested_range.removeprefix("bytes=").split("-")
                start, end = int(first or 0), int(last or len(AUDIO) - 1)
                headers["content-range"] = f"bytes {start}-{end}/{len(AUDIO)}"
                return await route.fulfill(status=206, headers=headers, content_type="audio/wav", body=AUDIO[start:end + 1])
            return await route.fulfill(headers=headers, content_type="audio/wav", body=AUDIO)
        elif path.endswith("/playback") or path == "/api/anki":
            data = {"result": 6, "error": None}
        elif path == "/zh-dict.json":
            data = {"entries": [], "simp": {}, "trad": {}}
        else:
            assert request.url.startswith(BASE), f"Unexpected external request: {request.url}"
            assert not path.startswith("/api/"), f"Unexpected API request: {path}"
            return await route.continue_()
        return await route.fulfill(content_type="application/json", body=json.dumps(data))

    await page.route("**/*", fixture)
    await page.goto(BASE + "/search")
    await expect(page.get_by_role("heading", name="Search transcripts", exact=True)).to_be_visible()
    if width < 768:
        await expect(page.locator("#app-tabs").get_by_role("link", name="Search")).to_have_attribute("aria-current", "page")
    else:
        await expect(page.get_by_role("link", name="Search transcripts", exact=True)).to_be_visible()
    await page.get_by_role("searchbox").fill("学习")
    await page.get_by_role("button", name="Search", exact=True).click()
    await expect(page.get_by_role("status").filter(has_text="21 matching passages")).to_be_visible()
    await expect(page.locator("mark")).to_have_count(40)
    assert set(await page.locator("mark").all_text_contents()) == {"学习"}
    assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    await page.get_by_role("link", name="Next", exact=True).click()
    await expect(page.locator("mark")).to_have_count(2)
    await page.get_by_role("link", name="Previous", exact=True).click()
    await expect(page.locator("mark")).to_have_count(40)
    await expect(page.get_by_role("searchbox")).to_have_value("学习")
    await page.get_by_role("combobox").select_option("p1")
    await page.get_by_role("button", name="Search", exact=True).click()
    await page.wait_for_url("**podcastId=p1**")
    await expect(page.get_by_role("combobox")).to_have_value("p1")

    await page.get_by_role("link", name="Listen at 0:42 in 学习的故事").first.click()
    await page.wait_for_url("**/player/e1?t=41.25")
    await asyncio.wait_for(audio_requested.wait(), timeout=10)
    release_audio.set()
    await page.wait_for_function("document.querySelector('audio')?.readyState >= 1")
    try:
        await page.wait_for_function("document.querySelector('audio')?.currentTime >= 41.25", timeout=10000)
    except Exception as error:
        details = await page.locator("audio").evaluate("audio => ({time: audio.currentTime, duration: audio.duration, ready: audio.readyState, paused: audio.paused, seekable: [...Array(audio.seekable.length)].map((_, i) => [audio.seekable.start(i), audio.seekable.end(i)]), error: audio.error?.message, slider: document.querySelector('[aria-label=Seek]')?.value})")
        raise AssertionError(details) from error
    position = await page.locator("audio").evaluate("audio => { audio.pause(); return audio.currentTime; }")
    assert 41.25 <= position < 44, position
    # A direct, fresh deep link at zero must also override the 90s resume point.
    await page.goto(BASE + "/player/e1?t=0")
    await page.wait_for_function("document.querySelector('audio')?.readyState >= 1")
    position = await page.locator("audio").evaluate("audio => { audio.pause(); return audio.currentTime; }")
    assert 0 <= position < 3, position

    await page.goto(BASE + "/search?q=missing")
    await expect(page.get_by_text("No examples found for “missing”.", exact=True)).to_be_visible()
    await page.get_by_role("searchbox").fill("failure")
    await page.get_by_role("button", name="Search", exact=True).click()
    await expect(page.get_by_text("Failed to load transcript search: Search unavailable", exact=True)).to_be_visible()
    assert not errors, errors
    await context.close()
    print(f"Transcript search browser checks passed at {width}px")


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_PATH"),
            args=["--autoplay-policy=no-user-gesture-required"],
        )
        try:
            for width in [390, 1280]:
                await check(browser, width)
        finally:
            await browser.close()


asyncio.run(main())

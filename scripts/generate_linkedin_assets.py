from __future__ import annotations

import asyncio
import json
import re
import shutil
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright
import websockets


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "docs" / "linkedin-assets"
FRAMES_DIR = OUTPUT_DIR / "_frames"
APP_URL = "http://127.0.0.1:3000"
API_URL = "http://127.0.0.1:8000"
WS_URL = "ws://127.0.0.1:8000"


def ensure_output_dir() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if FRAMES_DIR.exists():
        shutil.rmtree(FRAMES_DIR)
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)


def trigger_demo_run(run_id: str, company_name: str) -> dict[str, str]:
    params = urllib.parse.urlencode(
        {
            "run_id": run_id,
            "company_name": company_name,
            "sector": "saas_productivity",
        }
    )
    request = urllib.request.Request(f"{API_URL}/demo/async?{params}", method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def build_progressive_gif(frame_paths: list[Path], output_path: Path) -> None:
    frames: list[Image.Image] = []
    for frame_path in frame_paths:
        image = Image.open(frame_path).convert("RGB")
        image.thumbnail((1200, 1400))
        frames.append(image.quantize(colors=96, method=Image.MEDIANCUT))

    if not frames:
        raise RuntimeError("No frames captured for progressive-loading.gif")

    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        optimize=True,
        duration=900,
        loop=0,
    )


def capture_dashboard_assets() -> dict[str, str]:
    frame_paths: list[Path] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1600})
        page.goto(APP_URL, wait_until="networkidle", timeout=60_000)
        page.get_by_role("button", name="Run Live Demo").click()
        page.wait_for_url(re.compile(r".*/run/.*"), timeout=60_000)

        run_match = re.search(r"/run/([^/?#]+)", page.url)
        if not run_match:
            browser.close()
            raise RuntimeError("Could not determine run ID from dashboard URL")
        run_id = run_match.group(1)

        page.wait_for_timeout(600)
        for index in range(14):
            frame_path = FRAMES_DIR / f"progressive_{index:02d}.png"
            page.screenshot(path=str(frame_path))
            frame_paths.append(frame_path)
            if index >= 5 and page.locator("text=Complete ✓").first.is_visible():
                break
            page.wait_for_timeout(1100)

        build_progressive_gif(frame_paths, OUTPUT_DIR / "progressive-loading.gif")

        log_section = page.locator("section").filter(has_text="Pipeline Agent Log").first
        log_section.scroll_into_view_if_needed()
        page.evaluate(
            """
            () => {
              const section = Array.from(document.querySelectorAll("section"))
                .find((node) => node.textContent?.includes("Pipeline Agent Log"));
              const scroller = section?.querySelector(".max-h-60");
              if (scroller instanceof HTMLElement) {
                scroller.style.maxHeight = "none";
                scroller.style.overflow = "visible";
              }
            }
            """
        )
        page.wait_for_timeout(500)
        log_section.screenshot(path=str(OUTPUT_DIR / "agent-log.png"))

        browser.close()

    return {"dashboard_run_id": run_id}


async def collect_websocket_events(limit: int = 3) -> tuple[str, list[dict[str, object]]]:
    run_id = str(uuid.uuid4())
    events: list[dict[str, object]] = []

    async with websockets.connect(f"{WS_URL}/ws/pipeline/{run_id}") as websocket:
        trigger_demo_run(run_id, "WebSocket Capture")
        while len(events) < limit:
            payload = await asyncio.wait_for(websocket.recv(), timeout=45)
            event = json.loads(payload)
            events.append(event)

    return run_id, events


def render_websocket_capture(events: list[dict[str, object]], run_id: str) -> None:
    json_blocks = "\n\n".join(json.dumps(event, indent=2) for event in events)
    html = f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>WebSocket Events</title>
    <style>
      body {{
        margin: 0;
        padding: 32px;
        background: linear-gradient(180deg, #0f172a 0%, #111827 100%);
        font-family: "SF Pro Display", "Inter", "Segoe UI", sans-serif;
        color: #e2e8f0;
      }}
      .wrap {{
        max-width: 1100px;
        margin: 0 auto;
        border-radius: 28px;
        overflow: hidden;
        border: 1px solid rgba(148, 163, 184, 0.18);
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.35);
      }}
      .top {{
        padding: 18px 22px;
        background: linear-gradient(90deg, #0b1220 0%, #182033 100%);
        border-bottom: 1px solid rgba(148, 163, 184, 0.14);
      }}
      .eyebrow {{
        display: inline-block;
        padding: 7px 10px;
        border-radius: 999px;
        background: rgba(56, 189, 248, 0.12);
        border: 1px solid rgba(56, 189, 248, 0.22);
        color: #67e8f9;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }}
      h1 {{
        margin: 14px 0 4px;
        font-size: 28px;
        letter-spacing: -0.03em;
      }}
      p {{
        margin: 0;
        color: #94a3b8;
        font-size: 13px;
      }}
      pre {{
        margin: 0;
        padding: 26px 30px 30px;
        background: #020617;
        color: #dbeafe;
        font-size: 16px;
        line-height: 1.55;
        white-space: pre-wrap;
        word-break: break-word;
      }}
      .accent {{
        color: #67e8f9;
      }}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        <span class="eyebrow">WebSocket Frames</span>
        <h1>Pipeline stream for run <span class="accent">{run_id[:8]}</span></h1>
        <p>First three events captured from <code>ws://localhost:8000/ws/pipeline/&lt;run_id&gt;</code></p>
      </div>
      <pre>{json_blocks}</pre>
    </div>
  </body>
</html>
"""

    html_path = OUTPUT_DIR / "websocket-events.html"
    html_path.write_text(html, encoding="utf-8")
    json_path = OUTPUT_DIR / "websocket-events.json"
    json_path.write_text(json.dumps(events, indent=2), encoding="utf-8")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1300, "height": 1000}, device_scale_factor=2)
        page.set_content(html, wait_until="load")
        page.screenshot(path=str(OUTPUT_DIR / "websocket-events.png"))
        browser.close()


def write_metadata(data: dict[str, object]) -> None:
    metadata_path = OUTPUT_DIR / "metadata.json"
    metadata_path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def main() -> None:
    ensure_output_dir()

    dashboard_info = capture_dashboard_assets()
    websocket_run_id, events = asyncio.run(collect_websocket_events())
    render_websocket_capture(events, websocket_run_id)
    write_metadata(
        {
            **dashboard_info,
            "websocket_run_id": websocket_run_id,
            "files": [
                "progressive-loading.gif",
                "agent-log.png",
                "websocket-events.png",
                "websocket-events.json",
                "websocket-events.html",
            ],
        }
    )

    shutil.rmtree(FRAMES_DIR, ignore_errors=True)
    print(f"LinkedIn assets written to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()

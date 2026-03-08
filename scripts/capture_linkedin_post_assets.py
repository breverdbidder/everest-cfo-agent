from __future__ import annotations

import asyncio
import json
import re
import shutil
import uuid
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright
import websockets


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "docs" / "linkedin-assets"
FRAMES_DIR = OUTPUT_DIR / "_gif_frames"
APP_URL = "http://127.0.0.1:3000"
API_URL = "http://127.0.0.1:8000"
WS_URL = "ws://127.0.0.1:8000"


def ensure_dirs() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if FRAMES_DIR.exists():
        shutil.rmtree(FRAMES_DIR)
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)


def prepare_frame_dir(name: str) -> Path:
    frame_dir = FRAMES_DIR / name
    if frame_dir.exists():
        shutil.rmtree(frame_dir)
    frame_dir.mkdir(parents=True, exist_ok=True)
    return frame_dir


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


def dashboard_state(page) -> dict[str, object]:
    return page.evaluate(
        r"""
        () => {
          const overlayText = "Five AI agents are processing your financials in real time";
          const overlayVisible = document.body.innerText.includes(overlayText);
          const percentNodes = [...document.querySelectorAll("span")].filter((node) => {
            const text = (node.textContent || "").trim();
            if (!/^\d+%$/.test(text)) return false;
            const rect = node.getBoundingClientRect();
            return rect.top >= 0 && rect.top < 180;
          });
          const progress = percentNodes.length ? Number.parseInt((percentNodes[0].textContent || "0").replace("%", ""), 10) : null;
          const bannerNode = [...document.querySelectorAll("p")].find((node) => {
            const text = (node.textContent || "").trim();
            if (!text.includes("[")) return false;
            const rect = node.getBoundingClientRect();
            return rect.top >= 0 && rect.top < 220;
          });
          const bannerMessage = bannerNode ? (bannerNode.textContent || "").trim() : "";
          const completed = document.body.innerText.includes("Pipeline Agent Log") && document.body.innerText.includes("Complete");
          return {
            overlayVisible,
            progress,
            bannerMessage,
            completed,
          };
        }
        """
    )


def hide_loading_overlay(page) -> None:
    page.evaluate(
        r"""
        () => {
          const overlay = [...document.querySelectorAll("div")].find((node) =>
            (node.textContent || "").includes("Five AI agents are processing your financials in real time")
          );
          if (overlay instanceof HTMLElement) {
            overlay.style.display = "none";
          }
        }
        """
    )


def expand_agent_log(page) -> None:
    page.evaluate(
        r"""
        () => {
          const section = [...document.querySelectorAll("section")].find((node) =>
            (node.textContent || "").includes("Pipeline Agent Log")
          );
          const scroller = section?.querySelector(".max-h-60");
          if (scroller instanceof HTMLElement) {
            scroller.style.maxHeight = "none";
            scroller.style.overflow = "visible";
          }
        }
        """
    )


def build_gif(frame_paths: list[Path], output_path: Path) -> None:
    frames: list[Image.Image] = []
    for frame_path in frame_paths:
        image = Image.open(frame_path).convert("RGB")
        image.thumbnail((760, 1400))
        frames.append(image.quantize(colors=96, method=Image.MEDIANCUT))

    if not frames:
        raise RuntimeError("No frames captured for progressive loading GIF")

    durations = [900] * len(frames)
    if len(durations) >= 2:
        durations[0] = 1200
        durations[1] = 1200
        durations[-1] = 1200

    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        optimize=True,
        duration=durations,
        loop=0,
    )


def capture_progressive_loading_demo() -> str:
    frame_dir = prepare_frame_dir("progressive-loading-demo")
    frame_paths: list[Path] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1200})
        page.goto(APP_URL, wait_until="networkidle", timeout=60_000)

        for index in range(2):
            path = frame_dir / f"frame_{index:03d}.png"
            page.screenshot(path=str(path))
            frame_paths.append(path)
            page.wait_for_timeout(500)

        page.get_by_role("button", name="Run Live Demo").click()
        page.wait_for_url(re.compile(r".*/run/.*"), timeout=60_000)

        run_match = re.search(r"/run/([^/?#]+)", page.url)
        if not run_match:
            browser.close()
            raise RuntimeError("Could not determine run ID for GIF capture")
        run_id = run_match.group(1)

        steady_complete_frames = 0
        for index in range(2, 34):
            path = frame_dir / f"frame_{index:03d}.png"
            page.screenshot(path=str(path))
            frame_paths.append(path)
            state = dashboard_state(page)
            if not state["overlayVisible"] and state["completed"]:
                steady_complete_frames += 1
            else:
                steady_complete_frames = 0
            if steady_complete_frames >= 2:
                break
            page.wait_for_timeout(900)

        build_gif(frame_paths, OUTPUT_DIR / "progressive-loading-demo.gif")
        browser.close()

    return run_id


def capture_cfo_report_api_call_demo(run_id: str) -> dict[str, object]:
    frame_dir = prepare_frame_dir("cfo-report-api-call")
    frame_paths: list[Path] = []
    request_meta: dict[str, object] = {
        "method": "POST",
        "url": f"{API_URL}/report",
        "status": None,
        "ok": False,
    }

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1400})
        page.goto(f"{APP_URL}/run/{run_id}", wait_until="networkidle", timeout=120_000)

        for _ in range(90):
            if (
                page.locator("text=AI Intelligence Center").count() > 0
                and page.locator("text=Five AI agents are processing your financials in real time").count() == 0
            ):
                break
            page.wait_for_timeout(1_000)

        ai_section = page.locator("section").filter(has_text="AI Intelligence Center").first
        ai_section.scroll_into_view_if_needed()
        page.wait_for_timeout(500)

        def on_response(response) -> None:
            if response.request.method == "POST" and response.url.rstrip("/").endswith("/report"):
                request_meta["status"] = response.status
                request_meta["ok"] = response.ok

        page.on("response", on_response)

        page.get_by_role("button", name="CFO Report").first.click()
        page.wait_for_timeout(300)

        for index in range(3):
            path = frame_dir / f"frame_{index:03d}.png"
            ai_section.screenshot(path=str(path))
            frame_paths.append(path)
            page.wait_for_timeout(350)

        page.get_by_role("button", name="Generate CFO Report").click()

        loaded = False
        for index in range(3, 22):
            path = frame_dir / f"frame_{index:03d}.png"
            ai_section.screenshot(path=str(path))
            frame_paths.append(path)
            if ai_section.get_by_text("CFO Board Report").count() > 0:
                loaded = True
                break
            page.wait_for_timeout(650)

        if not loaded:
            page.wait_for_timeout(1500)

        expand_button = ai_section.get_by_role("button", name=re.compile("Expand|Collapse")).first
        if expand_button.count() > 0 and "Expand" in (expand_button.text_content() or ""):
            expand_button.click()
            page.wait_for_timeout(350)

        for index in range(22, 28):
            path = frame_dir / f"frame_{index:03d}.png"
            ai_section.screenshot(path=str(path))
            frame_paths.append(path)
            page.wait_for_timeout(500)

        build_gif(frame_paths, OUTPUT_DIR / "cfo-report-api-call.gif")
        browser.close()

    return {
        "run_id": run_id,
        "request": request_meta,
        "file": "cfo-report-api-call.gif",
    }


def capture_banner_and_log() -> str:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1400})
        page.goto(APP_URL, wait_until="networkidle", timeout=60_000)
        page.get_by_role("button", name="Run Live Demo").click()
        page.wait_for_url(re.compile(r".*/run/.*"), timeout=60_000)

        run_match = re.search(r"/run/([^/?#]+)", page.url)
        if not run_match:
            browser.close()
            raise RuntimeError("Could not determine run ID for banner/log capture")
        run_id = run_match.group(1)

        banner_saved = False
        for _ in range(40):
            page.wait_for_timeout(700)
            state = dashboard_state(page)
            progress = state["progress"]
            if (
                isinstance(progress, int)
                and 45 <= progress <= 90
                and state["bannerMessage"]
                and not banner_saved
            ):
                hide_loading_overlay(page)
                page.evaluate("window.scrollTo(0, 0)")
                page.wait_for_timeout(250)
                page.screenshot(
                    path=str(OUTPUT_DIR / "live-progress-banner.png"),
                    clip={"x": 0, "y": 0, "width": 1600, "height": 250},
                )
                banner_saved = True
                break

        page.wait_for_timeout(8000)
        expand_agent_log(page)
        log_section = page.locator("section").filter(has_text="Pipeline Agent Log").first
        log_section.scroll_into_view_if_needed()
        page.wait_for_timeout(500)
        log_section.screenshot(path=str(OUTPUT_DIR / "agent-log-panel.png"))

        browser.close()

    return run_id


async def collect_ws_events(limit: int = 10) -> tuple[str, list[dict[str, object]]]:
    run_id = str(uuid.uuid4())
    events: list[dict[str, object]] = []
    async with websockets.connect(f"{WS_URL}/ws/pipeline/{run_id}") as websocket:
        trigger_demo_run(run_id, "DevTools Capture")
        while len(events) < limit:
            payload = await asyncio.wait_for(websocket.recv(), timeout=45)
            event = json.loads(payload)
            events.append(event)
            if event.get("event_type") == "pipeline_completed":
                break
    return run_id, events


def render_devtools_style_capture(run_id: str, events: list[dict[str, object]]) -> None:
    request_rows = f"""
      <div class="row selected">
        <div class="name">pipeline/{run_id[:8]}</div>
        <div class="status">101</div>
        <div class="type">websocket</div>
      </div>
      <div class="row">
        <div class="name">demo/async</div>
        <div class="status">200</div>
        <div class="type">fetch</div>
      </div>
      <div class="row">
        <div class="name">runs/{run_id[:8]}/status</div>
        <div class="status">200</div>
        <div class="type">fetch</div>
      </div>
    """
    message_rows = "\n\n".join(json.dumps(event, indent=2) for event in events[:10])
    html = f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body {{
        margin: 0;
        background: #f5f5f7;
        font-family: Arial, Helvetica, sans-serif;
      }}
      .window {{
        width: 1600px;
        height: 980px;
        margin: 0 auto;
        background: #fff;
        box-shadow: 0 20px 50px rgba(0,0,0,0.18);
        overflow: hidden;
      }}
      .chrome {{
        height: 54px;
        background: #eef1f6;
        border-bottom: 1px solid #cfd6e4;
        display: flex;
        align-items: center;
        padding: 0 18px;
        gap: 18px;
        color: #334155;
        font-size: 14px;
      }}
      .chrome .active {{
        color: #0f62fe;
        font-weight: 700;
      }}
      .toolbar {{
        height: 42px;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 16px;
        border-bottom: 1px solid #d7deea;
        background: #ffffff;
        color: #475569;
        font-size: 13px;
      }}
      .layout {{
        display: grid;
        grid-template-columns: 480px 1fr;
        height: calc(980px - 96px);
      }}
      .left {{
        border-right: 1px solid #d7deea;
        background: #fbfcfe;
      }}
      .left-head {{
        display: grid;
        grid-template-columns: 1fr 88px 110px;
        padding: 10px 14px;
        border-bottom: 1px solid #d7deea;
        font-size: 12px;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }}
      .row {{
        display: grid;
        grid-template-columns: 1fr 88px 110px;
        padding: 12px 14px;
        border-bottom: 1px solid #ebeff5;
        font-size: 14px;
        color: #1f2937;
      }}
      .row.selected {{
        background: #e6f0ff;
        border-left: 4px solid #0f62fe;
        padding-left: 10px;
      }}
      .right {{
        display: flex;
        flex-direction: column;
      }}
      .tabs {{
        display: flex;
        gap: 18px;
        padding: 12px 18px 0;
        border-bottom: 1px solid #d7deea;
        font-size: 13px;
        color: #64748b;
      }}
      .tab {{
        padding: 0 0 10px;
      }}
      .tab.active {{
        color: #0f62fe;
        border-bottom: 2px solid #0f62fe;
        font-weight: 700;
      }}
      pre {{
        margin: 0;
        padding: 18px;
        flex: 1;
        overflow: hidden;
        background: #ffffff;
        color: #0f172a;
        font-size: 15px;
        line-height: 1.45;
        white-space: pre-wrap;
        word-break: break-word;
      }}
      .pill {{
        padding: 4px 8px;
        border-radius: 999px;
        background: #e8f1ff;
        color: #0f62fe;
        font-weight: 700;
      }}
      .muted {{
        color: #64748b;
      }}
    </style>
  </head>
  <body>
    <div class="window">
      <div class="chrome">
        <span>Elements</span>
        <span>Console</span>
        <span>Sources</span>
        <span class="active">Network</span>
        <span>Performance</span>
        <span>Application</span>
      </div>
      <div class="toolbar">
        <span class="pill">WS</span>
        <span class="muted">Messages</span>
        <span class="muted">Live capture from ws://localhost:8000/ws/pipeline/{run_id}</span>
      </div>
      <div class="layout">
        <div class="left">
          <div class="left-head">
            <div>Name</div>
            <div>Status</div>
            <div>Type</div>
          </div>
          {request_rows}
        </div>
        <div class="right">
          <div class="tabs">
            <div class="tab">Headers</div>
            <div class="tab active">Messages</div>
            <div class="tab">Timing</div>
          </div>
          <pre>{message_rows}</pre>
        </div>
      </div>
    </div>
  </body>
</html>
"""
    (OUTPUT_DIR / "websocket-events-devtools.json").write_text(json.dumps(events, indent=2), encoding="utf-8")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 980}, device_scale_factor=2)
        page.set_content(html, wait_until="load")
        page.screenshot(path=str(OUTPUT_DIR / "websocket-events-devtools.png"))
        browser.close()


def write_metadata(metadata: dict[str, object]) -> None:
    (OUTPUT_DIR / "monday-assets-metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def main() -> None:
    ensure_dirs()
    gif_run_id = capture_progressive_loading_demo()
    report_demo = capture_cfo_report_api_call_demo(gif_run_id)
    banner_run_id = capture_banner_and_log()
    ws_run_id, ws_events = asyncio.run(collect_ws_events())
    render_devtools_style_capture(ws_run_id, ws_events)
    write_metadata(
        {
            "progressive_loading_run_id": gif_run_id,
            "cfo_report_run_id": report_demo["run_id"],
            "cfo_report_request": report_demo["request"],
            "banner_log_run_id": banner_run_id,
            "websocket_run_id": ws_run_id,
            "files": [
                "websocket-events-devtools.png",
                "live-progress-banner.png",
                "agent-log-panel.png",
                "progressive-loading-demo.gif",
                "cfo-report-api-call.gif",
            ],
        }
    )
    shutil.rmtree(FRAMES_DIR, ignore_errors=True)
    print(f"Saved assets to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()

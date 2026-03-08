# LinkedIn Assets

Generated assets for product demos and social posts live in this folder.

Files:

- `progressive-loading.gif`: dashboard loading sequence from a real demo run
- `agent-log.png`: pipeline agent log screenshot with timestamps and progress
- `websocket-events.png`: WebSocket frame capture rendered as a shareable screenshot
- `websocket-events.json`: raw event payloads used for the screenshot
- `metadata.json`: run IDs used when generating the assets

To regenerate them locally:

```bash
python3 scripts/generate_linkedin_assets.py
```

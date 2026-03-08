"""
WebSocket streaming infrastructure for real-time pipeline updates.

Event types:
  pipeline_started   - Pipeline execution began
  agent_started      - Individual agent started processing
  agent_completed    - Agent finished, data available
  pipeline_completed - All agents finished
  pipeline_error     - Error occurred
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import WebSocket
from pydantic import BaseModel


class StreamEvent(BaseModel):
    event_id: str
    run_id: str
    timestamp: str
    event_type: str
    agent_name: str | None = None
    progress: int  # 0-100
    data: Dict[str, Any] | None = None
    message: str | None = None


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, run_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.setdefault(run_id, []).append(websocket)

    def disconnect(self, run_id: str, websocket: WebSocket) -> None:
        connections = self.active_connections.get(run_id, [])
        if websocket in connections:
            connections.remove(websocket)
        if not connections:
            self.active_connections.pop(run_id, None)

    async def broadcast(self, run_id: str, event: StreamEvent) -> None:
        connections = self.active_connections.get(run_id, [])
        if not connections:
            return
        dead: list[WebSocket] = []
        for ws in list(connections):
            try:
                await ws.send_json(event.model_dump())
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(run_id, ws)


# Module-level singleton - imported by graph nodes and the WebSocket endpoint.
manager = ConnectionManager()


async def publish_event(
    run_id: str | uuid.UUID,
    event_type: str,
    progress: int = 0,
    agent_name: str | None = None,
    data: Dict[str, Any] | None = None,
    message: str | None = None,
) -> None:
    """Publish a pipeline event to all WebSocket clients watching this run_id.

    Safe to call even when no client is connected - broadcasts are no-ops
    when the run_id has no active connections.
    """
    run_id_str = str(run_id)
    if run_id_str not in manager.active_connections:
        return
    event = StreamEvent(
        event_id=str(uuid.uuid4()),
        run_id=run_id_str,
        timestamp=datetime.now(timezone.utc).isoformat(),
        event_type=event_type,
        agent_name=agent_name,
        progress=progress,
        data=data,
        message=message,
    )
    try:
        await manager.broadcast(run_id_str, event)
    except Exception:
        pass  # Never let streaming failures crash the pipeline

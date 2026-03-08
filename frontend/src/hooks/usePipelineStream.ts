/**
 * usePipelineStream - real-time WebSocket hook with polling fallback.
 *
 * Strategy:
 *  1. Connect to WebSocket ws://{NEXT_PUBLIC_WS_URL}/ws/pipeline/{runId}
 *  2. If the connection doesn't open within 5 s, switch to polling
 *     GET /runs/{runId}/status every 2 s (existing endpoint, no backend change).
 *  3. Synthesise StreamEvent objects from polling responses so consumers
 *     see identical data regardless of transport.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";

export interface StreamEvent {
  event_id: string;
  run_id: string;
  timestamp: string;
  event_type: string; // pipeline_started | agent_started | agent_completed | pipeline_completed | pipeline_error
  agent_name?: string;
  progress: number;
  data?: Record<string, unknown>;
  message?: string;
}

export interface PipelineStreamState {
  connected: boolean;
  transport: "websocket" | "polling" | "idle";
  progress: number;
  events: StreamEvent[];
  completed: boolean;
  error: string | null;
}

const INITIAL_STATE: PipelineStreamState = {
  connected: false,
  transport: "idle",
  progress: 0,
  events: [],
  completed: false,
  error: null,
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function syntheticEvent(
  runId: string,
  eventType: string,
  progress: number,
  agentName?: string,
  message?: string,
): StreamEvent {
  return {
    event_id: `poll-${Date.now()}-${Math.random()}`,
    run_id: runId,
    timestamp: new Date().toISOString(),
    event_type: eventType,
    agent_name: agentName,
    progress,
    message,
  };
}

// Map the step IDs returned by /runs/{runId}/status to human-readable labels.
const STEP_LABELS: Record<string, { agent: string; message: string; progress: number }> = {
  ingestion:   { agent: "IngestionAgent", message: "Financial data ingested",          progress: 20 },
  kpi:         { agent: "AnalysisAgent",  message: "KPI snapshots computed",           progress: 50 },
  anomalies:   { agent: "AnalysisAgent",  message: "Anomalies detected",              progress: 65 },
  monte_carlo: { agent: "AnalysisAgent",  message: "Monte Carlo simulations complete", progress: 75 },
  scenarios:   { agent: "AnalysisAgent",  message: "Scenario stress test complete",    progress: 85 },
  market:      { agent: "MarketAgent",    message: "Competitor signals scanned",       progress: 95 },
};

// ─── hook ─────────────────────────────────────────────────────────────────────

export function usePipelineStream(runId: string | null): PipelineStreamState {
  const [state, setState] = useState<PipelineStreamState>(INITIAL_STATE);

  // Refs so closures always see latest values without stale-closure issues.
  const completedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenStepsRef = useRef<Set<string>>(new Set());

  const applyStatusSnapshot = useCallback((
    rId: string,
    json: {
      steps: Array<{ id: string; label: string; detail: string }>;
      complete: boolean;
    },
  ) => {
    const newEvents: StreamEvent[] = [];
    for (const step of json.steps) {
      if (!seenStepsRef.current.has(step.id)) {
        seenStepsRef.current.add(step.id);
        const meta = STEP_LABELS[step.id];
        if (meta) {
          newEvents.push(syntheticEvent(rId, "agent_completed", meta.progress, meta.agent, meta.message));
        }
      }
    }

    const derivedProgress = json.complete
      ? 100
      : newEvents.at(-1)?.progress
      ?? Math.max(...json.steps.map((step) => STEP_LABELS[step.id]?.progress ?? 0), 0);

    if (newEvents.length > 0 || json.complete) {
      setState(prev => ({
        ...prev,
        events: [...prev.events, ...newEvents],
        progress: derivedProgress,
        completed: json.complete,
      }));
    }

    if (json.complete) {
      completedRef.current = true;
      setState(prev => ({ ...prev, completed: true, progress: 100 }));
    }
  }, []);

  const clearAll = useCallback(() => {
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    if (pingRef.current) clearInterval(pingRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    if (wsTimeoutRef.current) clearTimeout(wsTimeoutRef.current);
    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent reconnect loop on intentional close
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // ── polling fallback ─────────────────────────────────────────────────────

  const startPolling = useCallback((rId: string) => {
    if (pollRef.current) return; // already polling

    setState(prev => ({ ...prev, transport: "polling", connected: true }));

    const pollOnce = async () => {
      if (completedRef.current) {
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/runs/${rId}/status`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json() as {
          steps: Array<{ id: string; label: string; detail: string }>;
          complete: boolean;
        };
        applyStatusSnapshot(rId, json);
        if (json.complete && pollRef.current) {
          clearInterval(pollRef.current);
        }
      } catch {
        // Network blip - keep polling
      }
    };

    void pollOnce();
    pollRef.current = setInterval(pollOnce, 2000);
  }, [applyStatusSnapshot]);

  const hydrateFromStatus = useCallback(async (rId: string) => {
    try {
      const res = await fetch(`${API_BASE}/runs/${rId}/status`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json() as {
        steps: Array<{ id: string; label: string; detail: string }>;
        complete: boolean;
      };
      applyStatusSnapshot(rId, json);
    } catch {
      // WebSocket can still deliver live progress if this request fails.
    }
  }, [applyStatusSnapshot]);

  // ── WebSocket connection ─────────────────────────────────────────────────

  const connect = useCallback((rId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_BASE}/ws/pipeline/${rId}`);
    wsRef.current = ws;

    // If WS doesn't connect within 5 s, fall back to polling.
    wsTimeoutRef.current = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
        startPolling(rId);
      }
    }, 5000);

    ws.onopen = () => {
      if (wsTimeoutRef.current) clearTimeout(wsTimeoutRef.current);
      setState(prev => ({ ...prev, connected: true, transport: "websocket", error: null }));
      void hydrateFromStatus(rId);

      // Keepalive ping every 30 s.
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping");
      }, 30_000);
    };

    ws.onmessage = (ev) => {
      let evt: StreamEvent;
      try {
        evt = JSON.parse(ev.data as string) as StreamEvent;
      } catch {
        return;
      }

      completedRef.current = evt.event_type === "pipeline_completed";

      setState(prev => ({
        ...prev,
        events: [...prev.events, evt],
        progress: evt.progress,
        completed: evt.event_type === "pipeline_completed",
        error: evt.event_type === "pipeline_error" ? (evt.message ?? "Pipeline error") : prev.error,
      }));
    };

    ws.onerror = () => {
      setState(prev => ({ ...prev, error: "WebSocket connection error" }));
    };

    ws.onclose = () => {
      if (pingRef.current) clearInterval(pingRef.current);
      setState(prev => ({ ...prev, connected: false }));

      if (!completedRef.current) {
        // Try to reconnect in 3 s; if that also fails within 5 s, polling takes over.
        reconnectRef.current = setTimeout(() => connect(rId), 3000);
      }
    };
  }, [hydrateFromStatus, startPolling]);

  // ── effect: start / stop ─────────────────────────────────────────────────

  useEffect(() => {
    if (!runId) return;

    completedRef.current = false;
    seenStepsRef.current = new Set();
    setState(INITIAL_STATE);

    connect(runId);

    return () => {
      clearAll();
    };
  }, [runId, connect, clearAll]);

  return state;
}

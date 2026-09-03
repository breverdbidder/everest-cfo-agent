import React, { useCallback, useEffect, useState } from "react";
import { apiGet, clearKey, getKey, setKey, UnauthorizedError } from "./api";
import { presetToRange } from "./dateRange";
import { TopBar } from "./components/TopBar";
import { KpiStrip } from "./components/KpiStrip";
import { CashChart } from "./components/CashChart";
import { CashflowChart } from "./components/CashflowChart";
import { BurnChart } from "./components/BurnChart";
import { CategoryDonut } from "./components/CategoryDonut";
import { CommingledTable } from "./components/CommingledTable";
import { ExceptionsTable } from "./components/ExceptionsTable";
import { ChatDrawer } from "./components/ChatDrawer";
import type {
  BurnResponse,
  CashflowResponse,
  CashResponse,
  CategoriesResponse,
  CommingledCostRow,
  EntitySelection,
  Grain,
  Preset,
  RecurringCostRow,
  ReconExceptionRow,
} from "./types";

interface VizState {
  cash: CashResponse | null;
  cashflow: CashflowResponse | null;
  burn: BurnResponse | null;
  categories: CategoriesResponse | null;
  recurring: RecurringCostRow[];
  commingled: CommingledCostRow[];
  exceptions: ReconExceptionRow[];
}

const EMPTY_VIZ: VizState = { cash: null, cashflow: null, burn: null, categories: null, recurring: [], commingled: [], exceptions: [] };

function Gate({ onEnter }: { onEnter: (key: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="gate">
      <h2>Everest CFO Agent</h2>
      <p style={{ color: "var(--text-dim)" }}>Internal-only. Enter access key.</p>
      <input
        type="password"
        placeholder="Access key"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && value.trim() && onEnter(value.trim())}
        aria-label="Access key"
      />
      <button type="button" onClick={() => value.trim() && onEnter(value.trim())}>
        Enter
      </button>
    </div>
  );
}

export function App() {
  const [authed, setAuthed] = useState(() => !!getKey());
  const [entity, setEntity] = useState<EntitySelection>("all");
  const [grain, setGrain] = useState<Grain>("month");
  const [preset, setPreset] = useState<Preset>("90d");
  const [viz, setViz] = useState<VizState>(EMPTY_VIZ);
  const [loading, setLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const handleUnauthorized = useCallback(() => {
    clearKey();
    setAuthed(false);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrorBanner(null);
    const { from, to } = presetToRange(preset);
    const entityParam = entity === "all" ? undefined : entity;
    try {
      const [cash, cashflow, burn, categories, recurring, commingled, exceptions] = await Promise.all([
        apiGet<CashResponse>("/api/viz/cash", { entity: entityParam, grain, from, to }),
        apiGet<CashflowResponse>("/api/viz/cashflow", { entity: entityParam, grain, from, to }),
        apiGet<BurnResponse>("/api/viz/burn", { entity: entityParam }),
        apiGet<CategoriesResponse>("/api/viz/categories", { entity: entityParam, from, to }),
        apiGet<{ costs: RecurringCostRow[] }>("/api/viz/recurring", { entity: entityParam }),
        apiGet<{ costs: CommingledCostRow[] }>("/api/viz/commingled", { entity: entityParam }),
        apiGet<{ exceptions: ReconExceptionRow[] }>("/api/viz/exceptions", { entity: entityParam }),
      ]);
      setViz({ cash, cashflow, burn, categories, recurring: recurring.costs, commingled: commingled.costs, exceptions: exceptions.exceptions });
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        handleUnauthorized();
        return;
      }
      setErrorBanner(`Failed to load dashboard data: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [entity, grain, preset, handleUnauthorized]);

  useEffect(() => {
    if (authed) loadAll();
  }, [authed, loadAll]);

  if (!authed) {
    return (
      <Gate
        onEnter={(key) => {
          setKey(key);
          setAuthed(true);
        }}
      />
    );
  }

  const netCashflow30d = viz.cashflow ? viz.cashflow.buckets.reduce((s, b) => s + b.net_cents, 0) : null;
  const lastBurnMonth = viz.burn?.months[viz.burn.months.length - 1] ?? null;
  const openExceptions = viz.exceptions.filter((e) => e.status === "open").length;

  return (
    <div className="app-shell">
      <TopBar entity={entity} onEntity={setEntity} grain={grain} onGrain={setGrain} preset={preset} onPreset={setPreset} asOf={viz.cash?.asOf ?? null} onOpenChat={() => setChatOpen(true)} />
      <main>
        {errorBanner && (
          <div className="error-banner" role="alert">
            {errorBanner}
          </div>
        )}
        <KpiStrip
          cashOnHandCents={viz.burn?.cashOnHandCents ?? null}
          netCashflow30dCents={netCashflow30d}
          monthlyBurnCents={lastBurnMonth?.expense_cents ?? null}
          runwayMonths={viz.burn?.runwayMonths ?? null}
          openExceptions={viz.exceptions.length > 0 ? openExceptions : null}
          loading={loading}
        />
        <CashChart data={viz.cash} loading={loading} />
        <CashflowChart data={viz.cashflow} loading={loading} />
        <BurnChart data={viz.burn} recurring={viz.recurring} loading={loading} />
        <CategoryDonut data={viz.categories} loading={loading} />
        <CommingledTable rows={viz.commingled} loading={loading} />
        <ExceptionsTable rows={viz.exceptions} loading={loading} />
      </main>
      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} onUnauthorized={handleUnauthorized} />
    </div>
  );
}

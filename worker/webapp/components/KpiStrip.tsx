import React from "react";
import { fmtMonths, fmtUsd } from "../format";

interface KpiStripProps {
  cashOnHandCents: number | null;
  netCashflow30dCents: number | null;
  monthlyBurnCents: number | null;
  runwayMonths: number | null;
  openExceptions: number | null;
  loading: boolean;
}

function Kpi({ label, value, tone, loading }: { label: string; value: string; tone?: "up" | "down" | "neutral"; loading: boolean }) {
  return (
    <div className="card kpi-card">
      <div className="label">{label}</div>
      {loading ? (
        <div className="skeleton skeleton-kpi" aria-hidden="true" />
      ) : (
        <div className={`value mono ${tone === "up" ? "status-healthy" : tone === "down" ? "status-critical" : ""}`}>{value}</div>
      )}
    </div>
  );
}

export function KpiStrip({ cashOnHandCents, netCashflow30dCents, monthlyBurnCents, runwayMonths, openExceptions, loading }: KpiStripProps) {
  return (
    <div className="grid kpi-strip" role="region" aria-label="Key performance indicators">
      <Kpi label="Cash on hand" value={fmtUsd(cashOnHandCents, { showCents: true })} loading={loading} />
      <Kpi
        label="30-day net cashflow"
        value={fmtUsd(netCashflow30dCents)}
        tone={netCashflow30dCents === null ? undefined : netCashflow30dCents >= 0 ? "up" : "down"}
        loading={loading}
      />
      <Kpi label="Monthly burn" value={fmtUsd(monthlyBurnCents)} loading={loading} />
      <Kpi label="Runway" value={fmtMonths(runwayMonths)} tone={runwayMonths !== null && runwayMonths < 3 ? "down" : undefined} loading={loading} />
      <Kpi
        label="Open exceptions"
        value={openExceptions === null ? "—" : String(openExceptions)}
        tone={openExceptions !== null && openExceptions > 0 ? "down" : "up"}
        loading={loading}
      />
    </div>
  );
}

import React from "react";
import type { EChartsOption } from "echarts";
import { CHART_COLORS, useECharts } from "../useECharts";
import { fmtMonthLabel, fmtMonths, fmtUsd, fmtUsdDollars } from "../format";
import { ChartCard } from "./ChartCard";
import type { BurnResponse, RecurringCostRow } from "../types";

export function BurnChart({ data, recurring, loading }: { data: BurnResponse | null; recurring: RecurringCostRow[]; loading: boolean }) {
  const isEmpty = !loading && (!data || data.months.length === 0);
  const runrateCents = Math.round((data?.recurringMonthlyRunrateDollars ?? 0) * 100);

  const option: EChartsOption | null = data
    ? {
        backgroundColor: "transparent",
        textStyle: { color: CHART_COLORS.text, fontFamily: "Inter, sans-serif" },
        grid: { left: 56, right: 24, top: 48, bottom: 40 },
        legend: { top: 0, textStyle: { color: CHART_COLORS.textDim } },
        tooltip: {
          trigger: "axis",
          valueFormatter: (v) => fmtUsd(v as number),
          backgroundColor: CHART_COLORS.surface,
          borderColor: CHART_COLORS.border,
          textStyle: { color: CHART_COLORS.text },
        },
        xAxis: {
          type: "category",
          data: data.months.map((m) => m.month),
          axisLabel: { color: CHART_COLORS.textDim, formatter: (v: string) => fmtMonthLabel(v) },
          axisLine: { lineStyle: { color: CHART_COLORS.border } },
        },
        yAxis: {
          type: "value",
          axisLabel: { color: CHART_COLORS.textDim, formatter: (v: number) => fmtUsd(v) },
          splitLine: { lineStyle: { color: CHART_COLORS.border } },
        },
        series: [
          {
            name: "Actual expense",
            type: "bar",
            data: data.months.map((m) => m.expense_cents),
            itemStyle: { color: CHART_COLORS.navy, borderColor: CHART_COLORS.amber, borderWidth: 1 },
          },
          {
            name: "Recurring run-rate",
            type: "line",
            data: data.months.map(() => runrateCents),
            symbol: "none",
            lineStyle: { type: "dashed", color: CHART_COLORS.amber, width: 2 },
          },
        ],
      }
    : null;

  const ref = useECharts(option, [data]);

  return (
    <>
      <ChartCard
        title="Burn trend"
        subtitle={
          data
            ? `3-mo avg burn ${fmtUsd(data.avg3MoBurnCents)}/mo · cash on hand ${fmtUsd(data.cashOnHandCents, { showCents: true })} · runway ${fmtMonths(data.runwayMonths)}`
            : undefined
        }
        isEmpty={isEmpty}
        isLoading={loading}
        emptyReason="No EXPENSE postings for this entity/range yet."
        chart={<div ref={ref} className="chart-canvas" role="img" aria-label="Monthly burn vs recurring run-rate" />}
        table={
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Expense</th>
                </tr>
              </thead>
              <tbody>
                {data?.months.map((m) => (
                  <tr key={m.month}>
                    <td>{fmtMonthLabel(m.month)}</td>
                    <td className="mono">{fmtUsd(m.expense_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        }
      />
      {recurring.length > 0 && (
        <section className="chart-card" aria-labelledby="recurring-costs-heading">
          <h3 id="recurring-costs-heading" className="subsection-heading">
            Recurring costs <span className="badge badge-real">REAL</span>
          </h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Account</th>
                  <th>Cadence</th>
                  <th>Last amount</th>
                  <th>Monthly run-rate</th>
                </tr>
              </thead>
              <tbody>
                {recurring.map((r, i) => (
                  <tr key={`${r.vendor}-${i}`}>
                    <td>{r.vendor}</td>
                    <td>{r.account_name}</td>
                    <td>{r.cadence}</td>
                    <td className="mono">{fmtUsdDollars(r.last_amount_dollars)}</td>
                    <td className="mono">{fmtUsdDollars(r.monthly_runrate_dollars)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

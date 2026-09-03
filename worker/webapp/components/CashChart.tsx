import React from "react";
import type { EChartsOption } from "echarts";
import { CHART_COLORS, CHART_PALETTE, useECharts } from "../useECharts";
import { fmtDate, fmtUsd } from "../format";
import { ChartCard } from "./ChartCard";
import type { CashResponse } from "../types";

export function CashChart({ data, loading }: { data: CashResponse | null; loading: boolean }) {
  const isEmpty = !loading && (!data || data.series.length === 0 || data.accounts.length === 0);

  const option: EChartsOption | null = data
    ? {
        backgroundColor: "transparent",
        textStyle: { color: CHART_COLORS.text, fontFamily: "Inter, sans-serif" },
        color: CHART_PALETTE,
        grid: { left: 56, right: 24, top: 48, bottom: 40 },
        legend: { top: 0, textStyle: { color: CHART_COLORS.textDim }, selectedMode: true },
        tooltip: {
          trigger: "axis",
          valueFormatter: (v) => fmtUsd(v as number, { showCents: true }),
          backgroundColor: CHART_COLORS.surface,
          borderColor: CHART_COLORS.border,
          textStyle: { color: CHART_COLORS.text },
        },
        xAxis: {
          type: "category",
          data: data.series.map((p) => p.date),
          axisLabel: { color: CHART_COLORS.textDim, formatter: (v: string) => fmtDate(v) },
          axisLine: { lineStyle: { color: CHART_COLORS.border } },
        },
        yAxis: {
          type: "value",
          axisLabel: { color: CHART_COLORS.textDim, formatter: (v: number) => fmtUsd(v) },
          splitLine: { lineStyle: { color: CHART_COLORS.border } },
        },
        series: [
          {
            name: "Total",
            type: "line",
            data: data.series.map((p) => p.total_cents),
            lineStyle: { width: 3, color: CHART_COLORS.amber },
            itemStyle: { color: CHART_COLORS.amber },
            symbol: "none",
          },
          ...data.accounts.map((a) => ({
            name: a.name,
            type: "line" as const,
            data: data.series.map((p) => p.byAccount[a.id] ?? 0),
            symbol: "none" as const,
            lineStyle: { width: 1.5, opacity: 0.8 },
          })),
        ],
      }
    : null;

  const ref = useECharts(option, [data]);

  return (
    <ChartCard
      title="Cash balance"
      subtitle="Per-account running balance, derived from bank_transactions and anchored to the live SimpleFIN balance."
      isEmpty={isEmpty}
      isLoading={loading}
      emptyReason="No bank accounts mapped to this entity."
      chart={<div ref={ref} className="chart-canvas" role="img" aria-label="Cash balance over time by account" />}
      table={
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Total</th>
                {data?.accounts.map((a) => <th key={a.id}>{a.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {data?.series.map((p) => (
                <tr key={p.date}>
                  <td>{fmtDate(p.date)}</td>
                  <td className="mono">{fmtUsd(p.total_cents, { showCents: true })}</td>
                  {data.accounts.map((a) => (
                    <td key={a.id} className="mono">
                      {fmtUsd(p.byAccount[a.id] ?? 0, { showCents: true })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    />
  );
}

import React from "react";
import type { EChartsOption } from "echarts";
import { CHART_COLORS, useECharts } from "../useECharts";
import { fmtDate, fmtUsd } from "../format";
import { ChartCard } from "./ChartCard";
import type { CashflowResponse } from "../types";

export function CashflowChart({ data, loading }: { data: CashflowResponse | null; loading: boolean }) {
  const isEmpty = !loading && (!data || data.buckets.every((b) => b.inflow_cents === 0 && b.outflow_cents === 0));

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
          data: data.buckets.map((b) => b.bucket),
          axisLabel: { color: CHART_COLORS.textDim, formatter: (v: string) => fmtDate(v) },
          axisLine: { lineStyle: { color: CHART_COLORS.border } },
        },
        yAxis: {
          type: "value",
          axisLabel: { color: CHART_COLORS.textDim, formatter: (v: number) => fmtUsd(v) },
          splitLine: { lineStyle: { color: CHART_COLORS.border } },
        },
        series: [
          { name: "Inflow", type: "bar", data: data.buckets.map((b) => b.inflow_cents), itemStyle: { color: CHART_COLORS.real } },
          { name: "Outflow", type: "bar", data: data.buckets.map((b) => -b.outflow_cents), itemStyle: { color: CHART_COLORS.danger } },
          {
            name: "Net",
            type: "line",
            data: data.buckets.map((b) => b.net_cents),
            symbol: "circle",
            symbolSize: 6,
            lineStyle: { color: CHART_COLORS.amber, width: 2 },
            itemStyle: { color: CHART_COLORS.amber },
          },
        ],
      }
    : null;

  const ref = useECharts(option, [data]);

  return (
    <ChartCard
      title="Cashflow"
      subtitle="Inflow / outflow / net, transfers between tracked accounts excluded."
      isEmpty={isEmpty}
      isLoading={loading}
      emptyReason="No non-transfer bank activity in this range."
      chart={<div ref={ref} className="chart-canvas" role="img" aria-label="Cashflow inflow, outflow, and net over time" />}
      table={
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Bucket</th>
                <th>Inflow</th>
                <th>Outflow</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {data?.buckets.map((b) => (
                <tr key={b.bucket}>
                  <td>{fmtDate(b.bucket)}</td>
                  <td className="mono status-healthy">{fmtUsd(b.inflow_cents)}</td>
                  <td className="mono status-critical">{fmtUsd(b.outflow_cents)}</td>
                  <td className={`mono ${b.net_cents >= 0 ? "status-healthy" : "status-critical"}`}>{fmtUsd(b.net_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    />
  );
}

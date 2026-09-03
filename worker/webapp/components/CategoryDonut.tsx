import React from "react";
import type { EChartsOption } from "echarts";
import { CHART_COLORS, CHART_PALETTE, useECharts } from "../useECharts";
import { fmtUsd } from "../format";
import { ChartCard } from "./ChartCard";
import type { CategoriesResponse } from "../types";

export function CategoryDonut({ data, loading }: { data: CategoriesResponse | null; loading: boolean }) {
  const isEmpty = !loading && (!data || data.categories.length === 0);

  const option: EChartsOption | null = data
    ? {
        backgroundColor: "transparent",
        textStyle: { color: CHART_COLORS.text, fontFamily: "Inter, sans-serif" },
        color: CHART_PALETTE,
        tooltip: {
          trigger: "item",
          valueFormatter: (v) => fmtUsd(v as number),
          backgroundColor: CHART_COLORS.surface,
          borderColor: CHART_COLORS.border,
          textStyle: { color: CHART_COLORS.text },
        },
        legend: { orient: "vertical", right: 8, top: 16, textStyle: { color: CHART_COLORS.textDim }, type: "scroll" },
        series: [
          {
            name: "Spend by category",
            type: "pie",
            radius: ["45%", "70%"],
            center: ["38%", "52%"],
            itemStyle: { borderColor: CHART_COLORS.surface, borderWidth: 2 },
            label: { color: CHART_COLORS.textDim, formatter: "{b}: {d}%" },
            data: data.categories.map((c) => ({ name: c.account_name, value: c.amount_cents })),
          },
        ],
      }
    : null;

  const ref = useECharts(option, [data]);

  return (
    <ChartCard
      title="Spend by category"
      subtitle="Expense postings grouped by chart-of-accounts category, with top vendors."
      isEmpty={isEmpty}
      isLoading={loading}
      emptyReason="No expense postings for this entity/range."
      chart={
        <div className="category-layout">
          <div ref={ref} className="chart-canvas" role="img" aria-label="Spend by category donut chart" />
          <VendorTable data={data} />
        </div>
      }
      table={
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {data?.categories.map((c) => (
                <tr key={c.account_code}>
                  <td>{c.account_name}</td>
                  <td className="mono">{fmtUsd(c.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    />
  );
}

function VendorTable({ data }: { data: CategoriesResponse | null }) {
  if (!data || data.topVendors.length === 0) return null;
  return (
    <div className="vendor-table">
      <h3 className="subsection-heading">Top vendors</h3>
      <table>
        <thead>
          <tr>
            <th>Vendor</th>
            <th>Amount</th>
            <th>Txns</th>
          </tr>
        </thead>
        <tbody>
          {data.topVendors.map((v) => (
            <tr key={v.vendor}>
              <td>{v.vendor}</td>
              <td className="mono">{fmtUsd(v.amount_cents)}</td>
              <td className="mono">{v.occurrences}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

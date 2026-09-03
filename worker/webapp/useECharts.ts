import { useEffect, useRef } from "react";
// Tree-shaken import (~1.2MB -> ~230KB minified): only the chart types, components, and
// renderer this SPA actually uses, instead of the full `echarts` bundle (3D/geo/maps/etc).
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

// Brand tokens (see public/styles.css :root) -- ECharts renders to <canvas>, so CSS
// variables aren't usable inside option objects; duplicated here deliberately.
export const CHART_COLORS = {
  amber: "#f59e0b",
  navy: "#1e3a5f",
  real: "#22c55e",
  danger: "#ef4444",
  textDim: "#94a3b8",
  text: "#e2e8f0",
  border: "#1f2c42",
  surface: "#0b1526",
};

export const CHART_PALETTE = ["#f59e0b", "#22c55e", "#38bdf8", "#a78bfa", "#f472b6", "#facc15", "#4ade80", "#94a3b8"];

/** Mounts/updates/disposes an ECharts instance on a div ref. `option` is applied with
 * notMerge=false so repeated calls (e.g. entity/grain toggles) animate cleanly. */
export function useECharts(option: EChartsOption | null, deps: unknown[]): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    // No named ECharts theme is registered -- charts are styled explicitly per-option
    // (backgroundColor: transparent + CHART_COLORS text/axis colors) to match the dark
    // brand surface instead.
    const chart = echarts.init(ref.current, undefined, { renderer: "svg" });
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!chartRef.current || !option) return;
    chartRef.current.setOption(option, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

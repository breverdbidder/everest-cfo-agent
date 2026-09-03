import React, { useState } from "react";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  chart: React.ReactNode;
  table: React.ReactNode;
  isEmpty?: boolean;
  isLoading?: boolean;
  emptyReason?: string;
}

/** Every chart section gets a "view as table" toggle (accessibility + DoD requirement) --
 * centralized here so each chart component only has to render its ECharts option and an
 * equivalent <table>, not re-implement the toggle chrome. */
export function ChartCard({ title, subtitle, badge, chart, table, isEmpty, isLoading, emptyReason }: ChartCardProps) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const titleId = `chart-title-${title.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <section className="chart-card" aria-labelledby={titleId}>
      <div className="chart-card-head">
        <div>
          <h2 id={titleId}>
            {title} {badge}
          </h2>
          {subtitle && <p className="chart-subtitle">{subtitle}</p>}
        </div>
        {!isEmpty && !isLoading && (
          <div className="view-toggle" role="group" aria-label={`${title} view`}>
            <button
              type="button"
              aria-pressed={view === "chart"}
              className={view === "chart" ? "toggle-active" : ""}
              onClick={() => setView("chart")}
            >
              Chart
            </button>
            <button
              type="button"
              aria-pressed={view === "table"}
              className={view === "table" ? "toggle-active" : ""}
              onClick={() => setView("table")}
            >
              Table
            </button>
          </div>
        )}
      </div>
      {isLoading ? (
        <div className="skeleton skeleton-chart" aria-hidden="true" />
      ) : isEmpty ? (
        <div className="empty-state">{emptyReason || "No data for this selection."}</div>
      ) : view === "chart" ? (
        chart
      ) : (
        table
      )}
    </section>
  );
}

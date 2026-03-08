"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BookmarkPlus,
  Bot,
  Clock3,
  Copy,
  Download,
  Printer,
  Scissors,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import { deleteSavedScenario, getSavedScenarios, saveScenario } from "@/lib/api";
import { fmtK, fmtPct } from "@/lib/utils";
import type {
  Anomaly,
  FraudAlert,
  KPISnapshot,
  MarketSignal,
  SavedScenarioRecord,
  ScenarioResult,
  SurvivalAnalysis,
} from "@/lib/types";
import {
  applyScenarioSimulation,
  applySnapshotSimulation,
  buildDecisionModel,
  type DecisionSimulation,
  type DecisionSimulationId,
  type RiskLevel,
} from "@/lib/decision-simulator";

interface Props {
  runId: string;
  companyName?: string;
  latest: KPISnapshot;
  snapshots: KPISnapshot[];
  anomalies: Anomaly[];
  fraudAlerts: FraudAlert[];
  signals: MarketSignal[];
  survival: SurvivalAnalysis | null;
  scenarios: ScenarioResult[];
  activeSimulationId: DecisionSimulationId | null;
  onSelectSimulation: (simulation: DecisionSimulation | null) => void;
}

const RISK_STYLES: Record<RiskLevel, string> = {
  Low: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Medium: "border-amber-200 bg-amber-50 text-amber-700",
  High: "border-rose-200 bg-rose-50 text-rose-700",
};

const ICONS: Record<DecisionSimulationId, typeof Scissors> = {
  burn_reset: Scissors,
  pricing_test: TrendingUp,
  hiring_freeze: Users,
  retention_sprint: Target,
  cleanup: ShieldAlert,
} as const;

const ICON_STYLES: Record<DecisionSimulationId, string> = {
  burn_reset: "bg-emerald-100 text-emerald-700",
  pricing_test: "bg-blue-100 text-blue-700",
  hiring_freeze: "bg-amber-100 text-amber-700",
  retention_sprint: "bg-violet-100 text-violet-700",
  cleanup: "bg-rose-100 text-rose-700",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatMonths(value: number): string {
  return value >= 9.95 ? `${value.toFixed(0)} mo` : `${value.toFixed(1)} mo`;
}

function formatScore(value: number): string {
  return `${Math.round(clamp(value, 0, 100))}`;
}

function scoreNarrative(score: number, risk: RiskLevel): string {
  if (score >= 78 && risk === "Low") return "High-conviction move with controllable downside.";
  if (score >= 62) return "Strong lever, but execution discipline matters.";
  return "Useful move, but keep it paired with tighter weekly review.";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function scenarioLabel(id: DecisionSimulationId): string {
  return id
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function fileSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "board_snapshot";
}

function buildSnapshotHtml({
  companyName,
  runId,
  lever,
  latest,
  scenarios,
  survival,
  highIssues,
  pricingSignals,
  activeCompetitors,
}: {
  companyName?: string;
  runId: string;
  lever: DecisionSimulation;
  latest: KPISnapshot;
  scenarios: ScenarioResult[];
  survival: SurvivalAnalysis | null;
  highIssues: number;
  pricingSignals: number;
  activeCompetitors: number;
}): string {
  const name = companyName || "AI CFO Portfolio Company";
  const proofRows = lever.proofPoints.map((item) => `<span class="proof-pill">${escapeHtml(item)}</span>`).join("");
  const scenarioRows = scenarios.map((item) => `
    <tr>
      <td>${escapeHtml(item.scenario.toUpperCase())}</td>
      <td>${item.months_runway.toFixed(1)} mo</td>
      <td>$${Math.round(item.projected_mrr_6mo).toLocaleString()}</td>
      <td>${escapeHtml(item.series_a_readiness.replace("_", " "))}</td>
    </tr>
  `).join("");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(name)} Board Snapshot</title>
      <style>
        :root {
          color-scheme: light;
          --ink: #0f172a;
          --muted: #475569;
          --line: #dbe4ee;
          --panel: #ffffff;
          --tint: #eef6ff;
          --accent: #0f766e;
          --accent-2: #0f172a;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
          background: linear-gradient(180deg, #eef7ff 0%, #f8fafc 100%);
          color: var(--ink);
          padding: 40px 24px;
        }
        .sheet {
          max-width: 980px;
          margin: 0 auto;
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 28px;
          overflow: hidden;
          box-shadow: 0 24px 80px rgba(15, 23, 42, 0.08);
        }
        .hero {
          padding: 34px 36px 28px;
          background: radial-gradient(circle at top left, rgba(56,189,248,0.28), transparent 34%), linear-gradient(135deg, #0f172a 0%, #111827 48%, #164e63 100%);
          color: #fff;
          text-align: center;
        }
        .kicker {
          display: inline-block;
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.08);
          font-size: 11px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          font-weight: 700;
        }
        h1 {
          margin: 16px 0 8px;
          font-size: 38px;
          line-height: 1.05;
          letter-spacing: -0.04em;
        }
        .sub {
          margin: 0 auto;
          max-width: 760px;
          color: rgba(255,255,255,0.78);
          line-height: 1.6;
          font-size: 15px;
        }
        .meta {
          margin-top: 18px;
          font-size: 12px;
          color: rgba(255,255,255,0.72);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .body {
          padding: 28px 36px 34px;
        }
        .metrics {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }
        .metric {
          border: 1px solid var(--line);
          border-radius: 20px;
          padding: 18px;
          background: #fff;
          text-align: center;
        }
        .metric .label {
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--muted);
          font-weight: 700;
        }
        .metric .value {
          margin-top: 8px;
          font-size: 30px;
          line-height: 1;
          font-weight: 700;
          letter-spacing: -0.03em;
        }
        .grid {
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          gap: 18px;
          margin-top: 18px;
        }
        .card {
          border: 1px solid var(--line);
          border-radius: 24px;
          padding: 22px;
          background: #fff;
        }
        .card h2 {
          margin: 0 0 12px;
          font-size: 15px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: var(--muted);
        }
        .action-title {
          font-size: 26px;
          line-height: 1.15;
          font-weight: 700;
          letter-spacing: -0.03em;
        }
        .action-copy {
          margin-top: 10px;
          color: #334155;
          line-height: 1.7;
        }
        .pill-row {
          margin-top: 16px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .pill {
          border-radius: 999px;
          padding: 8px 12px;
          background: var(--tint);
          color: #075985;
          font-size: 12px;
          font-weight: 700;
        }
        .proof-row {
          margin-top: 14px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .proof-pill {
          border-radius: 999px;
          padding: 7px 11px;
          background: #f8fafc;
          border: 1px solid #dbe4ee;
          color: #334155;
          font-size: 12px;
          font-weight: 700;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 12px;
          overflow: hidden;
          border-radius: 18px;
        }
        th, td {
          padding: 12px 14px;
          border-bottom: 1px solid #e8eef5;
          text-align: left;
          font-size: 13px;
        }
        th {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: var(--muted);
          background: #f8fafc;
        }
        tr:last-child td { border-bottom: none; }
        .note {
          margin-top: 14px;
          padding: 14px 16px;
          border-radius: 18px;
          background: #f8fafc;
          color: #334155;
          line-height: 1.7;
          font-size: 14px;
        }
        @media print {
          body { background: white; padding: 0; }
          .sheet { box-shadow: none; border: none; }
        }
      </style>
    </head>
    <body>
      <section class="sheet">
        <div class="hero">
          <div class="kicker">Board Snapshot</div>
          <h1>${escapeHtml(name)}</h1>
          <p class="sub">
            ${escapeHtml(lever.title)} is the selected plan. It moves modeled runway from ${lever.baselineRunwayMonths.toFixed(1)} to ${lever.projectedRunwayMonths.toFixed(1)} months without any new external financing.
          </p>
          <div class="meta">Run ${escapeHtml(runId.slice(0, 8))} • ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
        </div>
        <div class="body">
          <div class="metrics">
            <div class="metric">
              <div class="label">Weekly MRR</div>
              <div class="value">$${Math.round(latest.mrr).toLocaleString()}</div>
            </div>
            <div class="metric">
              <div class="label">Weekly Burn</div>
              <div class="value">$${Math.round(latest.burn_rate).toLocaleString()}</div>
            </div>
            <div class="metric">
              <div class="label">Churn</div>
              <div class="value">${(latest.churn_rate * 100).toFixed(1)}%</div>
            </div>
            <div class="metric">
              <div class="label">180d Zero-Cash Risk</div>
              <div class="value">${survival ? `${(survival.probability_ruin_180d * 100).toFixed(0)}%` : "n/a"}</div>
            </div>
          </div>

          <div class="grid">
            <div class="card">
              <h2>Selected Action</h2>
              <div class="action-title">${escapeHtml(lever.title)}</div>
              <div class="action-copy">${escapeHtml(lever.summary)}</div>
              <div class="pill-row">
                <span class="pill">+${lever.runwayDeltaMonths.toFixed(1)} months runway</span>
                <span class="pill">+${Math.round(lever.weeklyImpact).toLocaleString()}/week swing</span>
                <span class="pill">${escapeHtml(lever.owner)}</span>
                <span class="pill">${escapeHtml(lever.timeline)}</span>
              </div>
              <div class="proof-row">${proofRows}</div>
            </div>
            <div class="card">
              <h2>Context</h2>
              <div class="note">
                ${escapeHtml(name)} is being evaluated against ${activeCompetitors} live competitors, ${pricingSignals} pricing signals, and ${highIssues} internal high-severity flags. The current plan is optimized for speed, controllability, and runway extension.
              </div>
            </div>
          </div>

          <div class="card" style="margin-top: 18px;">
            <h2>Scenario View</h2>
            <table>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Runway</th>
                  <th>Projected MRR</th>
                  <th>Readiness</th>
                </tr>
              </thead>
              <tbody>${scenarioRows}</tbody>
            </table>
          </div>
        </div>
      </section>
    </body>
  </html>`;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawRoundedPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke?: string,
) {
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 4,
): number {
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let currentY = y;
  let linesDrawn = 0;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) {
      ctx.fillText(line, x, currentY);
      currentY += lineHeight;
      linesDrawn += 1;
    }
    if (linesDrawn >= maxLines - 1) {
      const remainingWords = [word, ...words.slice(index + 1)];
      let truncated = remainingWords.join(" ");
      while (truncated.length > 0 && ctx.measureText(`${truncated}…`).width > maxWidth) {
        truncated = truncated.slice(0, -1);
      }
      ctx.fillText(`${truncated}…`, x, currentY);
      return currentY + lineHeight;
    }
    line = word;
  }

  if (line) {
    ctx.fillText(line, x, currentY);
    currentY += lineHeight;
  }

  return currentY;
}

function drawPill(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  fill: string,
  color: string,
  border = fill,
): number {
  ctx.font = "700 18px 'Avenir Next', 'Segoe UI', sans-serif";
  const width = Math.ceil(ctx.measureText(label).width + 26);
  drawRoundedPanel(ctx, x, y, width, 34, 17, fill, border);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 13, y + 17);
  return width;
}

async function renderSnapshotCanvas({
  companyName,
  runId,
  lever,
  latest,
  scenarios,
  survival,
  highIssues,
  pricingSignals,
  activeCompetitors,
}: {
  companyName?: string;
  runId: string;
  lever: DecisionSimulation;
  latest: KPISnapshot;
  scenarios: ScenarioResult[];
  survival: SurvivalAnalysis | null;
  highIssues: number;
  pricingSignals: number;
  activeCompetitors: number;
}): Promise<HTMLCanvasElement> {
  if (typeof document !== "undefined" && "fonts" in document) {
    try {
      await document.fonts.ready;
    } catch {
      // Font loading failures should not block exports.
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 980;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas export unavailable");

  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, "#eef7ff");
  bg.addColorStop(1, "#f8fafc");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.shadowColor = "rgba(15, 23, 42, 0.08)";
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 18;
  drawRoundedPanel(ctx, 70, 46, 1460, 888, 34, "#ffffff", "#dbe4ee");
  ctx.shadowColor = "transparent";

  roundedRectPath(ctx, 70, 46, 1460, 250, 34);
  ctx.save();
  ctx.clip();
  const hero = ctx.createLinearGradient(70, 46, 1530, 296);
  hero.addColorStop(0, "#0f172a");
  hero.addColorStop(0.52, "#111827");
  hero.addColorStop(1, "#164e63");
  ctx.fillStyle = hero;
  ctx.fillRect(70, 46, 1460, 250);
  const flare = ctx.createRadialGradient(170, 70, 0, 170, 70, 320);
  flare.addColorStop(0, "rgba(56,189,248,0.28)");
  flare.addColorStop(1, "rgba(56,189,248,0)");
  ctx.fillStyle = flare;
  ctx.fillRect(70, 46, 760, 250);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  drawRoundedPanel(ctx, 664, 86, 272, 34, 17, "rgba(255,255,255,0.08)", "rgba(255,255,255,0.14)");
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 14px 'Avenir Next', 'Segoe UI', sans-serif";
  ctx.fillText("BOARD SNAPSHOT", 800, 103);

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 54px 'Avenir Next', 'Segoe UI', sans-serif";
  ctx.fillText(companyName || "AI CFO Portfolio Company", 800, 154);

  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = "500 24px 'Avenir Next', 'Segoe UI', sans-serif";
  drawWrappedText(
    ctx,
    `${lever.title} is the selected plan. It moves modeled runway from ${lever.baselineRunwayMonths.toFixed(1)} to ${lever.projectedRunwayMonths.toFixed(1)} months without any new external financing.`,
    280,
    202,
    1040,
    34,
    3,
  );

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "600 16px 'Avenir Next', 'Segoe UI', sans-serif";
  ctx.fillText(
    `RUN ${runId.slice(0, 8).toUpperCase()} • ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    800,
    262,
  );

  const metricCards = [
    ["Weekly MRR", `$${Math.round(latest.mrr).toLocaleString()}`],
    ["Weekly Burn", `$${Math.round(latest.burn_rate).toLocaleString()}`],
    ["Churn", `${(latest.churn_rate * 100).toFixed(1)}%`],
    ["180d Zero-Cash Risk", survival ? `${(survival.probability_ruin_180d * 100).toFixed(0)}%` : "n/a"],
  ] as const;

  metricCards.forEach(([label, value], index) => {
    const x = 110 + index * 350;
    drawRoundedPanel(ctx, x, 332, 310, 116, 24, "#ffffff", "#dbe4ee");
    ctx.fillStyle = "#64748b";
    ctx.font = "700 13px 'Avenir Next', 'Segoe UI', sans-serif";
    ctx.fillText(label, x + 155, 364);
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 38px 'Avenir Next', 'Segoe UI', sans-serif";
    ctx.fillText(value, x + 155, 409);
  });

  drawRoundedPanel(ctx, 110, 476, 860, 248, 28, "#ffffff", "#dbe4ee");
  drawRoundedPanel(ctx, 998, 476, 492, 248, 28, "#ffffff", "#dbe4ee");
  drawRoundedPanel(ctx, 110, 752, 1380, 150, 28, "#ffffff", "#dbe4ee");

  ctx.textAlign = "left";
  ctx.fillStyle = "#64748b";
  ctx.font = "700 15px 'Avenir Next', 'Segoe UI', sans-serif";
  ctx.fillText("SELECTED ACTION", 142, 514);
  ctx.fillText("CONTEXT", 1030, 514);
  ctx.fillText("SCENARIO VIEW", 142, 790);

  ctx.fillStyle = "#0f172a";
  ctx.font = "700 36px 'Avenir Next', 'Segoe UI', sans-serif";
  let actionY = drawWrappedText(ctx, lever.title, 142, 560, 790, 42, 3);
  ctx.fillStyle = "#334155";
  ctx.font = "500 22px 'Avenir Next', 'Segoe UI', sans-serif";
  actionY = drawWrappedText(ctx, lever.summary, 142, actionY + 6, 790, 30, 3);

  let pillX = 142;
  const pillY = actionY + 14;
  [
    `+${lever.runwayDeltaMonths.toFixed(1)} months runway`,
    `+${Math.round(lever.weeklyImpact).toLocaleString()}/week swing`,
    lever.owner,
    lever.timeline,
  ].forEach((item, index) => {
    const width = drawPill(
      ctx,
      item,
      pillX,
      pillY + (index > 1 ? 42 : 0),
      "#eef6ff",
      "#075985",
      "#dbeafe",
    );
    pillX += width + 10;
    if (pillX > 760) {
      pillX = 142;
    }
  });

  let proofX = 142;
  lever.proofPoints.forEach((item, index) => {
    const width = drawPill(
      ctx,
      item,
      proofX,
      pillY + 84 + Math.floor(index / 2) * 42,
      "#f8fafc",
      "#334155",
      "#dbe4ee",
    );
    proofX += width + 10;
    if (proofX > 760) {
      proofX = 142;
    }
  });

  ctx.fillStyle = "#334155";
  ctx.font = "500 21px 'Avenir Next', 'Segoe UI', sans-serif";
  drawWrappedText(
    ctx,
    `${companyName || "This company"} is being evaluated against ${activeCompetitors} live competitors, ${pricingSignals} pricing signals, and ${highIssues} internal high-severity flags. The current plan is optimized for speed, controllability, and runway extension.`,
    1030,
    560,
    430,
    31,
    6,
  );

  const columns = ["Scenario", "Runway", "Projected MRR", "Readiness"];
  const colX = [142, 450, 760, 1105];
  ctx.fillStyle = "#64748b";
  ctx.font = "700 14px 'Avenir Next', 'Segoe UI', sans-serif";
  columns.forEach((label, index) => ctx.fillText(label.toUpperCase(), colX[index], 836));
  ctx.strokeStyle = "#e8eef5";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(142, 850);
  ctx.lineTo(1458, 850);
  ctx.stroke();

  scenarios.forEach((item, index) => {
    const y = 885 + index * 34;
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 18px 'Avenir Next', 'Segoe UI', sans-serif";
    ctx.fillText(item.scenario.toUpperCase(), colX[0], y);
    ctx.fillText(`${item.months_runway.toFixed(1)} mo`, colX[1], y);
    ctx.fillText(`$${Math.round(item.projected_mrr_6mo).toLocaleString()}`, colX[2], y);
    ctx.fillText(item.series_a_readiness.replace("_", " "), colX[3], y);
  });

  return canvas;
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-center backdrop-blur-sm">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

export function DecisionEngine({
  runId,
  companyName,
  latest,
  snapshots,
  anomalies,
  fraudAlerts,
  signals,
  survival,
  scenarios,
  activeSimulationId,
  onSelectSimulation,
}: Props) {
  const model = useMemo(() => buildDecisionModel({
    latest,
    snapshots,
    anomalies,
    fraudAlerts,
    signals,
    survival,
    scenarios,
  }), [latest, snapshots, anomalies, fraudAlerts, signals, survival, scenarios]);
  const activeLever = model.levers.find((lever) => lever.id === activeSimulationId) ?? null;
  const displayLever = activeLever ?? model.best;
  const displayScenarios = useMemo(
    () => (activeLever ? applyScenarioSimulation(scenarios, activeLever) : scenarios),
    [activeLever, scenarios],
  );
  const displayLatest = useMemo(
    () => applySnapshotSimulation(latest, activeLever),
    [latest, activeLever],
  );
  const decisionScore = Math.round(displayLever.score);
  const [savedScenarios, setSavedScenarios] = useState<SavedScenarioRecord[]>([]);
  const [saveLabel, setSaveLabel] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "error">("success");
  const [vaultLoading, setVaultLoading] = useState(true);
  const [vaultBusyId, setVaultBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVaultLoading(true);
    getSavedScenarios(runId)
      .then((items) => {
        if (!cancelled) {
          setSavedScenarios(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSavedScenarios([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setVaultLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (!statusMessage) return;
    const id = window.setTimeout(() => setStatusMessage(null), 2600);
    return () => window.clearTimeout(id);
  }, [statusMessage]);

  const showStatus = (message: string, tone: "success" | "error" = "success") => {
    setStatusTone(tone);
    setStatusMessage(message);
  };

  const handleSelect = (lever: DecisionSimulation) => {
    onSelectSimulation(activeSimulationId === lever.id ? null : lever);
  };

  const handleSaveScenario = async () => {
    const label = saveLabel.trim() || `${scenarioLabel(displayLever.id)} Plan`;
    setVaultBusyId("save");
    try {
      const saved = await saveScenario(runId, {
        label,
        simulation_id: displayLever.id,
        summary: displayLever.summary,
        runway_months_before: displayLever.baselineRunwayMonths,
        runway_months_after: displayLever.projectedRunwayMonths,
        weekly_impact: displayLever.weeklyImpact,
        proof_points: displayLever.proofPoints,
      });
      setSavedScenarios((current) => [saved, ...current.filter((item) => item.id !== saved.id)].slice(0, 8));
      setSaveLabel("");
      showStatus(`Saved ${saved.label}`);
    } catch {
      showStatus("Couldn't save this scenario right now.", "error");
    } finally {
      setVaultBusyId(null);
    }
  };

  const handleDeleteScenario = async (id: string) => {
    setVaultBusyId(id);
    try {
      await deleteSavedScenario(runId, id);
      setSavedScenarios((current) => current.filter((item) => item.id !== id));
      showStatus("Deleted saved scenario");
    } catch {
      showStatus("Couldn't delete this scenario right now.", "error");
    } finally {
      setVaultBusyId(null);
    }
  };

  const handleLoadScenario = (item: SavedScenarioRecord) => {
    const lever = model.levers.find((candidate) => candidate.id === item.simulation_id);
    if (!lever) return;
    onSelectSimulation(lever);
    showStatus(`Loaded ${item.label}`);
  };

  const handleDownloadSnapshot = () => {
    const html = buildSnapshotHtml({
      companyName,
      runId,
      lever: displayLever,
      latest: displayLatest,
      scenarios: displayScenarios,
      survival,
      highIssues: model.highIssues,
      pricingSignals: model.pricingSignals,
      activeCompetitors: model.activeCompetitors,
    });
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const fileBase = fileSlug(companyName || "board_snapshot");
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: `${fileBase}_${displayLever.id}_snapshot.html`,
    });
    link.click();
    URL.revokeObjectURL(url);
    showStatus("Downloaded HTML snapshot");
  };

  const handlePrintSnapshot = () => {
    const html = buildSnapshotHtml({
      companyName,
      runId,
      lever: displayLever,
      latest: displayLatest,
      scenarios: displayScenarios,
      survival,
      highIssues: model.highIssues,
      pricingSignals: model.pricingSignals,
      activeCompetitors: model.activeCompetitors,
    });
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1100,height=900");
    if (!printWindow) {
      showStatus("Pop-up blocked. Allow pop-ups to print the snapshot.", "error");
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
    showStatus("Opened print view");
  };

  const handleDownloadPng = async () => {
    try {
      const canvas = await renderSnapshotCanvas({
        companyName,
        runId,
        lever: displayLever,
        latest: displayLatest,
        scenarios: displayScenarios,
        survival,
        highIssues: model.highIssues,
        pricingSignals: model.pricingSignals,
        activeCompetitors: model.activeCompetitors,
      });
      const link = Object.assign(document.createElement("a"), {
        href: canvas.toDataURL("image/png"),
        download: `${fileSlug(companyName || "board_snapshot")}_${displayLever.id}_snapshot.png`,
      });
      link.click();
      showStatus("Downloaded PNG snapshot");
    } catch {
      showStatus("PNG export is unavailable in this browser.", "error");
    }
  };

  const handleCopySummary = async () => {
    const lines = [
      `${companyName || "Company"} board snapshot`,
      `Selected action: ${displayLever.title}`,
      `Modeled runway: ${displayLever.baselineRunwayMonths.toFixed(1)} -> ${displayLever.projectedRunwayMonths.toFixed(1)} months`,
      `Weekly impact: +${Math.round(displayLever.weeklyImpact).toLocaleString()}/week`,
      `Proof: ${displayLever.proofPoints.join(" | ")}`,
      `Weekly MRR: ${fmtK(displayLatest.mrr)}`,
      `Weekly burn: ${fmtK(displayLatest.burn_rate)}`,
      `Scenarios: ${displayScenarios.map((item) => `${item.scenario} ${item.months_runway.toFixed(1)}mo`).join(" | ")}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showStatus("Copied board snapshot summary");
    } catch {
      showStatus("Clipboard unavailable in this browser", "error");
    }
  };

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.32),_transparent_32%),linear-gradient(135deg,_#0f172a_0%,_#111827_48%,_#164e63_100%)] px-5 py-4 sm:px-6">
        <div className="text-center lg:text-left">
          <div className="mx-auto max-w-5xl">
            <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              <span className="inline-flex items-center justify-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100">
                <Bot className="h-3 w-3" />
                AI CFO Decision Engine
              </span>
              <span className="inline-flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                <Sparkles className="h-3 w-3" />
                Zero Paid API Calls
              </span>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[108px_minmax(0,1fr)]">
              <div className="rounded-[24px] border border-white/10 bg-white/10 px-3 py-3 text-center backdrop-blur-sm">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100">Action score</div>
                <div className="mt-1 text-3xl font-semibold tracking-tight text-white">{formatScore(decisionScore)}</div>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-3 text-center sm:text-left">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">Readout</div>
                <p className="mt-1 text-sm leading-5 text-slate-200">
                  {activeLever
                    ? `${activeLever.title} is live across the model. ${scoreNarrative(decisionScore, displayLever.risk)}`
                    : `${model.subhead} ${scoreNarrative(decisionScore, displayLever.risk)}`}
                </p>
              </div>
            </div>

            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {activeLever ? "Simulation applied across the dashboard." : model.headline}
            </h3>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-300">
              {activeLever
                ? `${activeLever.title} is now driving runway, scenarios, and the 13-week cash view below.`
                : `${displayLever.title} is currently top-ranked for speed, control, and modeled cash impact.`}
            </p>

            <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
              <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100">
                  {activeLever ? "Simulation active" : "Best move right now"}
                </span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${RISK_STYLES[displayLever.risk]}`}>
                  {displayLever.risk} risk
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                  Tap any card below to apply it
                </span>
                {activeLever && (
                  <button
                    type="button"
                    onClick={() => onSelectSimulation(null)}
                    className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold text-white transition-colors hover:bg-white/20"
                  >
                    Back to actuals
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:text-left">
                <div>
                  <div className="text-xl font-semibold text-white">{displayLever.title}</div>
                  <div className="mt-1 text-sm text-slate-300">{displayLever.summary}</div>
                </div>
                <div className="flex flex-wrap justify-center gap-2 sm:justify-end">
                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                    +{formatMonths(displayLever.runwayDeltaMonths)} runway
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
                    +{fmtK(displayLever.weeklyImpact)}/wk swing
                  </span>
                </div>
              </div>
              <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Actual</div>
                  <div className="mt-1 text-lg font-semibold text-white">
                    {formatMonths(displayLever.baselineRunwayMonths)} runway
                  </div>
                </div>
                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-3 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Modeled</div>
                  <div className="mt-1 text-lg font-semibold text-white">
                    {formatMonths(displayLever.projectedRunwayMonths)} runway
                  </div>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap justify-center gap-2 lg:justify-start">
                {displayLever.proofPoints.map((point) => (
                  <span
                    key={point}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-200"
                  >
                    {point}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
              <MetricPill label="Base Runway" value={formatMonths(model.baseRunway)} />
              <MetricPill label="Churn" value={fmtPct(model.churnRate)} />
              <MetricPill label="Top Delta" value={`+${formatMonths(displayLever.runwayDeltaMonths)}`} />
              <MetricPill
                label="Confidence"
                value={`${Math.round(displayLever.confidence * 100)}%`}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[1.45fr_0.95fr] sm:p-5">
        <div className="space-y-3">
          {model.levers.slice(0, 3).map((lever, index) => {
            const Icon = ICONS[lever.id];
            const isActive = activeLever?.id === lever.id;
            const isRecommended = !activeLever && model.best.id === lever.id;
            return (
              <button
                key={lever.id}
                type="button"
                onClick={() => handleSelect(lever)}
                className={`w-full rounded-2xl border px-4 py-3.5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                  isActive
                    ? "border-cyan-300 bg-cyan-50/60 ring-2 ring-cyan-200"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl ${ICON_STYLES[lever.id]}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                        {isActive ? "Applied to model" : `#${index + 1} this week`}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {lever.category}
                      </span>
                      {isRecommended && (
                        <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-700">
                          Recommended
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h4 className="text-base font-semibold text-slate-900">{lever.title}</h4>
                        <p className="mt-1 text-sm leading-5 text-slate-600">{lever.summary}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {lever.proofPoints.map((point) => (
                            <span
                              key={point}
                              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
                            >
                              {point}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-center sm:min-w-[112px] sm:self-start">
                        <div className="text-lg font-semibold text-slate-900">+{formatMonths(lever.runwayDeltaMonths)}</div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          modeled runway
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                        Owner: {lever.owner}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                        Timeline: {lever.timeline}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${RISK_STYLES[lever.risk]}`}>
                        {lever.risk} risk
                      </span>
                      <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700">
                        +{fmtK(lever.weeklyImpact)}/wk swing
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-center gap-2 text-center">
              <Target className="h-4 w-4 text-slate-500" />
              <h4 className="text-sm font-semibold text-slate-900">What the model compared</h4>
            </div>
            <div className="mt-3 space-y-2.5">
              {model.levers.map((lever) => (
                <button
                  key={lever.id}
                  type="button"
                  onClick={() => handleSelect(lever)}
                  className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${
                    activeLever?.id === lever.id
                      ? "border-cyan-200 bg-cyan-50"
                      : "border-white bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{lever.title}</div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {activeLever?.id === lever.id ? "Applied" : "Tap to apply"} • {Math.round(lever.confidence * 100)}% confidence
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {lever.proofPoints.slice(0, 2).map((point) => (
                          <span
                            key={point}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                          >
                            {point}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-semibold text-slate-900">+{formatMonths(lever.runwayDeltaMonths)}</div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">impact</div>
                    </div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-600"
                      style={{ width: `${clamp(lever.score, 8, 100)}%` }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-center gap-2 text-center">
              <Clock3 className="h-4 w-4 text-slate-500" />
              <h4 className="text-sm font-semibold text-slate-900">Board clock</h4>
            </div>
            <div className="mt-3 space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-center text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  Context
                </div>
                <p className="mt-1 text-center text-sm leading-6 text-slate-700">
                  {companyName || "This company"} is being modeled off {formatMonths(model.baseRunway)} of base-case runway,
                  {` ${model.activeCompetitors}`} active competitors with live signals,
                  {` ${model.pricingSignals}`} pricing moves, and {model.highIssues} high-severity internal flags.
                </p>
              </div>

              {(model.fundraisingDate || model.baseRunway < 6) && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center justify-center gap-2 text-amber-800">
                    <ArrowUpRight className="h-4 w-4" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em]">
                      Fundraising timing
                    </span>
                  </div>
                  <p className="mt-1 text-center text-sm leading-6 text-amber-900">
                    {model.fundraisingDate
                      ? `If you want a normal process instead of an emergency one, start fundraising by ${model.fundraisingDate}.`
                      : "Runway is tight enough that fundraising should move from background task to active work now."}
                  </p>
                </div>
              )}

              {model.survivalRisk !== null && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-center gap-2 text-slate-700">
                    <ShieldAlert className="h-4 w-4" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em]">
                      180-day risk
                    </span>
                  </div>
                  <p className="mt-1 text-center text-sm leading-6 text-slate-700">
                    Current modeled probability of hitting zero cash within 180 days:{" "}
                    <span className="font-semibold text-slate-900">{fmtPct(model.survivalRisk)}</span>.
                    That is why the top-ranked plays skew toward controllable cash and retention levers.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100">
                <BookmarkPlus className="h-4 w-4 text-slate-700" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Scenario Vault</h4>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Save the current play so you can reload it later from this run.
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={saveLabel}
                onChange={(event) => setSaveLabel(event.target.value)}
                placeholder={`${scenarioLabel(displayLever.id)} Plan`}
                className="h-11 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition-colors focus:border-cyan-300 focus:bg-white"
              />
              <button
                type="button"
                onClick={handleSaveScenario}
                disabled={vaultBusyId === "save"}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                <BookmarkPlus className="h-4 w-4" />
                {vaultBusyId === "save" ? "Saving…" : "Save"}
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {vaultLoading ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                  Loading saved scenarios…
                </div>
              ) : savedScenarios.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                  No saved scenarios yet. Saved plans live in the backend for this run.
                </div>
              ) : (
                savedScenarios.map((item) => {
                  const isCurrent = activeLever?.id === item.simulation_id;
                  return (
                    <div
                      key={item.id}
                      className={`rounded-2xl border px-3 py-3 transition-colors ${
                        isCurrent ? "border-cyan-200 bg-cyan-50" : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">{item.label}</div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {scenarioLabel(item.simulation_id as DecisionSimulationId)} • {new Date(item.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </div>
                          {item.summary && (
                            <p className="mt-2 text-xs leading-5 text-slate-600">{item.summary}</p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {item.proof_points.slice(0, 3).map((point) => (
                              <span
                                key={point}
                                className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                              >
                                {point}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteScenario(item.id)}
                          disabled={vaultBusyId === item.id}
                          className="rounded-full p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Delete ${item.label}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-cyan-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-cyan-700">
                          {item.runway_months_before.toFixed(1)} → {item.runway_months_after.toFixed(1)} mo
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                          +{fmtK(item.weekly_impact)}/wk swing
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLoadScenario(item)}
                        className="mt-3 inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:border-slate-300"
                      >
                        {isCurrent ? "Applied" : "Load scenario"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-sm">
                <Download className="h-4 w-4 text-slate-700" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Board Snapshot</h4>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Export the currently applied plan as a shareable artifact.
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleDownloadPng}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-semibold text-cyan-800 transition-colors hover:border-cyan-300"
              >
                <Download className="h-4 w-4" />
                Download PNG
              </button>
              <button
                type="button"
                onClick={handleDownloadSnapshot}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-300"
              >
                <Download className="h-4 w-4" />
                Download HTML
              </button>
              <button
                type="button"
                onClick={handlePrintSnapshot}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-300"
              >
                <Printer className="h-4 w-4" />
                Print View
              </button>
              <button
                type="button"
                onClick={handleCopySummary}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-300"
              >
                <Copy className="h-4 w-4" />
                Copy Summary
              </button>
              <div className="sm:col-span-2 flex items-center justify-center rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-center text-[11px] leading-5 text-slate-500">
                Current export reflects the selected plan, simulated metrics, and scenario table.
              </div>
            </div>

            {statusMessage && (
              <div className={`mt-3 rounded-2xl px-4 py-3 text-center text-sm font-medium ${
                statusTone === "error"
                  ? "border border-rose-200 bg-rose-50 text-rose-800"
                  : "border border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}>
                {statusMessage}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

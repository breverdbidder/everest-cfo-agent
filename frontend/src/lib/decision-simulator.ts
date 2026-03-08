import type {
  Anomaly,
  CashFlowSectionData,
  FraudAlert,
  KPISnapshot,
  MarketSignal,
  ScenarioResult,
  SurvivalAnalysis,
} from "./types";

export type RiskLevel = "Low" | "Medium" | "High";
export type DecisionSimulationId =
  | "burn_reset"
  | "pricing_test"
  | "hiring_freeze"
  | "retention_sprint"
  | "cleanup";

export interface DecisionSimulation {
  id: DecisionSimulationId;
  title: string;
  summary: string;
  proofPoints: string[];
  owner: string;
  timeline: string;
  category: string;
  risk: RiskLevel;
  confidence: number;
  score: number;
  weeklyImpact: number;
  weeklyBurnSavings: number;
  weeklyMrrGain: number;
  runwayDeltaMonths: number;
  baselineRunwayMonths: number;
  projectedRunwayMonths: number;
}

export interface DecisionModel {
  baseRunway: number;
  currentCash: number;
  best: DecisionSimulation;
  levers: DecisionSimulation[];
  headline: string;
  subhead: string;
  activeCompetitors: number;
  pricingSignals: number;
  highIssues: number;
  fundraisingDate: string | null;
  survivalRisk: number | null;
  churnRate: number;
}

type DecisionSimulationSeed = Omit<
  DecisionSimulation,
  | "proofPoints"
  | "runwayDeltaMonths"
  | "weeklyImpact"
  | "baselineRunwayMonths"
  | "projectedRunwayMonths"
  | "weeklyBurnSavings"
  | "weeklyMrrGain"
>;

interface BuildModelInput {
  latest: KPISnapshot;
  snapshots: KPISnapshot[];
  anomalies: Anomaly[];
  fraudAlerts: FraudAlert[];
  signals: MarketSignal[];
  survival: SurvivalAnalysis | null;
  scenarios: ScenarioResult[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatFundraisingDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(value);
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(Math.abs(value) >= 0.1 ? 0 : 1)}%`;
}

function formatSignedPct(value: number): string {
  const percent = value * 100;
  const digits = Math.abs(percent) >= 10 ? 0 : 1;
  const prefix = percent > 0 ? "+" : "";
  return `${prefix}${percent.toFixed(digits)}%`;
}

function formatCurrencyCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

export function estimateCurrentCash(snapshots: KPISnapshot[], latestMrr: number): number {
  const totalBurned = snapshots.reduce((sum, item) => sum + (item.burn_rate || 0), 0);
  const initialCash = Math.max(latestMrr * 18, totalBurned * 2);
  return Math.max(initialCash - totalBurned, latestMrr * 2);
}

export function projectedRunwayMonths(
  currentCash: number,
  latestBurn: number,
  weeklyBurnSavings: number,
  weeklyMrrGain: number,
): number {
  const adjustedBurn = Math.max(latestBurn - weeklyBurnSavings - weeklyMrrGain, 0);
  if (adjustedBurn <= 50) return 36;
  return Math.min(36, currentCash / adjustedBurn / 4.33);
}

function readinessFromProjectedState(projectedMrr: number, monthsRunway: number): ScenarioResult["series_a_readiness"] {
  if (projectedMrr >= 100_000 && monthsRunway >= 12) return "READY";
  if (projectedMrr >= 50_000 || monthsRunway >= 8) return "6_MONTHS";
  return "NOT_READY";
}

export function buildDecisionModel({
  latest,
  snapshots,
  anomalies,
  fraudAlerts,
  signals,
  survival,
  scenarios,
}: BuildModelInput): DecisionModel {
  const latestBurn = latest.burn_rate || 0;
  const latestMrr = latest.mrr || 0;
  const currentCash = estimateCurrentCash(snapshots, latestMrr);
  const scenarioBase = scenarios.find((item) => item.scenario === "base");
  const scenarioBear = scenarios.find((item) => item.scenario === "bear");
  const baseRunway = scenarioBase?.months_runway
    ?? projectedRunwayMonths(currentCash, latestBurn, 0, 0);
  const bearRunway = scenarioBear?.months_runway ?? Math.max(baseRunway * 0.8, 0);

  const highAnomalies = anomalies.filter((item) => item.severity === "HIGH").length;
  const highFraud = fraudAlerts.filter((item) => item.severity === "HIGH").length;
  const highIssues = highAnomalies + highFraud;

  const pricingSignals = signals.filter((item) => item.signal_type === "pricing_change").length;
  const hiringSignals = signals.filter((item) => item.signal_type === "job_posting").length;
  const activeCompetitors = new Set(signals.map((item) => item.competitor_name)).size;

  const churnRate = latest.churn_rate || 0;
  const grossMargin = latest.gross_margin || 0;
  const wowBurn = latest.wow_delta?.burn_rate ?? 0;
  const momMrr = latest.mom_delta?.mrr ?? 0;

  const runwayPressure = clamp((8 - baseRunway) / 8, 0, 1);
  const survivalPressure = survival
    ? clamp((survival.probability_ruin_180d - 0.15) / 0.45, 0, 1)
    : runwayPressure;
  const burnSpike = clamp((wowBurn + 0.03) / 0.2, 0, 1);
  const growthGap = clamp((0.06 - momMrr) / 0.12, 0, 1);
  const churnPressure = clamp((churnRate - 0.03) / 0.05, 0, 1);
  const marginStrength = clamp((grossMargin - 0.45) / 0.25, 0, 1);
  const issuePressure = clamp(highIssues / 4, 0, 1);
  const pricingPressure = clamp(pricingSignals / Math.max(activeCompetitors, 3), 0, 1);
  const hiringHeat = clamp(hiringSignals / Math.max(activeCompetitors, 3), 0, 1);
  const bearGap = clamp((baseRunway - bearRunway) / Math.max(baseRunway, 1), 0, 1);

  const pricingAdoption = clamp(
    0.35 + pricingPressure * 0.25 + (1 - churnPressure) * 0.2,
    0.25,
    0.8,
  );
  const retentionCoverage = churnRate > 0.05 ? 0.08 : churnRate > 0.03 ? 0.05 : 0.03;

  const createLever = (
    base: DecisionSimulationSeed,
    weeklyBurnSavings: number,
    weeklyMrrGain: number,
    proofPoints: string[],
  ): DecisionSimulation => {
    const projected = projectedRunwayMonths(currentCash, latestBurn, weeklyBurnSavings, weeklyMrrGain);
    return {
      ...base,
      proofPoints,
      weeklyBurnSavings,
      weeklyMrrGain,
      weeklyImpact: weeklyBurnSavings + weeklyMrrGain,
      baselineRunwayMonths: baseRunway,
      projectedRunwayMonths: projected,
      runwayDeltaMonths: Math.max(0, projected - baseRunway),
    };
  };

  const levers: DecisionSimulation[] = [
    createLever(
      {
        id: "burn_reset",
        title: "Trim discretionary spend 10% for the next 8 weeks",
        summary: runwayPressure > 0.45
          ? "This is the fastest way to buy time without waiting on new revenue or outside capital."
          : "A short spend reset creates a buffer while you decide where to keep pressing.",
        owner: "Finance + Ops",
        timeline: "7 days",
        category: "Cash",
        risk: "Low",
        confidence: 0.92,
        score: 100 * (0.46 * runwayPressure + 0.24 * burnSpike + 0.18 * survivalPressure + 0.12 * issuePressure),
      },
      latestBurn * 0.1,
      0,
      [
        `Runway ${baseRunway.toFixed(1)} mo`,
        `Burn ${formatSignedPct(wowBurn)} WoW`,
        `180d ruin ${formatPct(survival?.probability_ruin_180d ?? runwayPressure)}`,
      ],
    ),
    createLever(
      {
        id: "pricing_test",
        title: "Run a 5% pricing test on new and expansion deals",
        summary: pricingPressure > 0.25
          ? "Competitors are already moving on pricing, which gives you air cover to test stronger packaging."
          : "A narrow pricing test is cheaper than adding headcount and improves cash generation quickly.",
        owner: "CEO + GTM",
        timeline: "14 days",
        category: "Monetization",
        risk: churnPressure > 0.55 ? "High" : churnPressure > 0.25 ? "Medium" : "Low",
        confidence: clamp(0.58 + pricingPressure * 0.15 + (1 - churnPressure) * 0.1, 0.55, 0.86),
        score: 100 * (0.3 * growthGap + 0.24 * pricingPressure + 0.2 * marginStrength + 0.16 * (1 - churnPressure) + 0.1 * runwayPressure),
      },
      0,
      latestMrr * 0.05 * pricingAdoption,
      [
        `${pricingSignals} pricing moves`,
        `Gross margin ${formatPct(grossMargin)}`,
        `Churn ${formatPct(churnRate)}`,
      ],
    ),
    createLever(
      {
        id: "hiring_freeze",
        title: "Freeze non-critical hiring for 30 days",
        summary: hiringHeat > 0.35
          ? "The market is noisy and competitors are still hiring; preserving optionality matters more than matching them."
          : "Pause new roles until revenue catches up with burn and the cash curve stabilizes.",
        owner: "CEO + Finance",
        timeline: "30 days",
        category: "Ops",
        risk: "Low",
        confidence: 0.81,
        score: 100 * (0.35 * runwayPressure + 0.3 * burnSpike + 0.2 * hiringHeat + 0.15 * survivalPressure),
      },
      latestBurn * (hiringHeat > 0.6 ? 0.07 : 0.05),
      0,
      [
        `Burn ${formatSignedPct(wowBurn)} WoW`,
        `${activeCompetitors} live competitors`,
        `Cash ${formatCurrencyCompact(currentCash)}`,
      ],
    ),
    createLever(
      {
        id: "retention_sprint",
        title: "Launch a renewal and expansion sprint on the top accounts",
        summary: churnPressure > 0.15
          ? "Retention is the cheapest growth lever available when churn starts eating efficiency."
          : "Protecting top accounts compounds every other growth lever and steadies the downside case.",
        owner: "CS + Sales",
        timeline: "21 days",
        category: "Retention",
        risk: "Low",
        confidence: clamp(0.68 + churnPressure * 0.18 + bearGap * 0.08, 0.64, 0.9),
        score: 100 * (0.45 * churnPressure + 0.25 * bearGap + 0.2 * growthGap + 0.1 * runwayPressure),
      },
      0,
      latestMrr * retentionCoverage * 0.65,
      [
        `Churn ${formatPct(churnRate)}`,
        `Bear/base gap ${formatPct(bearGap)}`,
        `Weekly MRR ${formatCurrencyCompact(latestMrr)}`,
      ],
    ),
    createLever(
      {
        id: "cleanup",
        title: "Close the high-severity anomalies before next week closes",
        summary: highIssues > 0
          ? "The cheapest leaks to plug are already flagged in your own data, so this is unusually actionable."
          : "Tightening controls now prevents small misses from turning into systemic drag later.",
        owner: "Finance",
        timeline: "5 days",
        category: "Control",
        risk: "Low",
        confidence: clamp(0.76 + issuePressure * 0.16, 0.76, 0.92),
        score: 100 * (0.58 * issuePressure + 0.18 * runwayPressure + 0.14 * burnSpike + 0.1 * survivalPressure),
      },
      latestBurn * Math.min(0.02 * Math.max(highIssues, 1), 0.08),
      0,
      [
        `${highIssues} high-severity flags`,
        `Burn ${formatSignedPct(wowBurn)} WoW`,
        `Runway ${baseRunway.toFixed(1)} mo`,
      ],
    ),
  ].sort((a, b) => b.score - a.score);

  const best = [...levers].sort((a, b) => {
    const riskWeight = (risk: RiskLevel) => (risk === "Low" ? 1 : risk === "Medium" ? 0.88 : 0.74);
    const scoreA = a.score * a.confidence * riskWeight(a.risk);
    const scoreB = b.score * b.confidence * riskWeight(b.risk);
    return scoreB - scoreA;
  })[0];

  const headline = baseRunway < 6
    ? "Defend cash before you chase growth."
    : growthGap > 0.45
    ? "Monetization is the cleanest lever right now."
    : "You have room to press, but only with tighter control.";

  const subhead = baseRunway < 6
    ? `Base runway is ${baseRunway.toFixed(1)} months, so the priority is buying time with moves you control directly.`
    : churnPressure > 0.25
    ? "Runway is workable, but churn is expensive enough that retention and pricing should outrank hiring."
    : "The balance sheet is not screaming, which means you can optimize for efficient growth instead of pure defense.";

  return {
    baseRunway,
    currentCash,
    best,
    levers,
    headline,
    subhead,
    activeCompetitors,
    pricingSignals,
    highIssues,
    fundraisingDate: formatFundraisingDate(survival?.fundraising_deadline),
    survivalRisk: survival?.probability_ruin_180d ?? null,
    churnRate,
  };
}

export function applyScenarioSimulation(
  scenarios: ScenarioResult[],
  simulation: DecisionSimulation | null,
): ScenarioResult[] {
  if (!simulation) return scenarios;

  const scenarioWeights: Record<ScenarioResult["scenario"], { runway: number; mrr: number }> = {
    bear: { runway: 0.72, mrr: 0.7 },
    base: { runway: 1.0, mrr: 1.0 },
    bull: { runway: 1.18, mrr: 1.18 },
  };

  return scenarios.map((scenario) => {
    const weight = scenarioWeights[scenario.scenario];
    const monthsRunway = Math.max(
      0.5,
      Number((scenario.months_runway + simulation.runwayDeltaMonths * weight.runway).toFixed(1)),
    );
    const projectedMrr = Math.max(
      0,
      scenario.projected_mrr_6mo + simulation.weeklyMrrGain * 26 * weight.mrr,
    );
    const seriesAReadiness = readinessFromProjectedState(projectedMrr, monthsRunway);
    const recommendedActions = Array.from(new Set([
      `Apply: ${simulation.title}`,
      ...scenario.recommended_actions,
    ])).slice(0, 3);

    return {
      ...scenario,
      months_runway: monthsRunway,
      projected_mrr_6mo: Number(projectedMrr.toFixed(2)),
      series_a_readiness: seriesAReadiness,
      recommended_actions: recommendedActions,
    };
  });
}

export function applyCashFlowSimulation(
  data: CashFlowSectionData | null,
  simulation: DecisionSimulation | null,
): CashFlowSectionData | null {
  if (!data || !simulation) return data;

  const weeklyDelta = simulation.weeklyBurnSavings + simulation.weeklyMrrGain;
  const forecast = data.forecast.map((week, index) => {
    const periodsOut = Math.max(index + 1, 1);
    const cumulative = weeklyDelta * periodsOut;
    return {
      ...week,
      expected_inflows: week.expected_inflows + simulation.weeklyMrrGain,
      expected_outflows: Math.max(0, week.expected_outflows - simulation.weeklyBurnSavings),
      predicted_balance_p10: week.predicted_balance_p10 + cumulative * 0.9,
      predicted_balance_p50: week.predicted_balance_p50 + cumulative,
      predicted_balance_p90: week.predicted_balance_p90 + cumulative * 1.08,
    };
  });

  const zeroWeek = forecast.find((week) => week.predicted_balance_p50 <= 0)?.week_offset ?? null;

  return {
    ...data,
    forecast,
    weeks_until_zero_p50: zeroWeek,
  };
}

export function applySnapshotSimulation(
  latest: KPISnapshot,
  simulation: DecisionSimulation | null,
): KPISnapshot {
  if (!simulation) return latest;
  const adjustedMrr = Math.max(0, latest.mrr + simulation.weeklyMrrGain);
  const adjustedBurn = Math.max(0, latest.burn_rate - simulation.weeklyBurnSavings);
  return {
    ...latest,
    mrr: adjustedMrr,
    arr: adjustedMrr * 12,
    burn_rate: adjustedBurn,
  };
}

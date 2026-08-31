// Ported from agents/analysis.py::compute_survival_analysis and ::compute_scenario_stress_test
// (daniel-st3/ai-cfo-agent). Formulas, thresholds, and simulation parameters (N=1000,
// 54-week horizon, seed=42) preserved verbatim. RNG is a seeded JS substitute — see
// docs/PORTING_NOTES.md and lib/rng.ts for why output isn't bit-identical to numpy.

import type { KPISnapshot, ScenarioResult, SurvivalAnalysis } from "./types";
import { SeededRng, mean, median, stddev } from "./rng";

function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (Math.abs(denominator) < 1e-12) return fallback;
  return numerator / denominator;
}

function delta(current: number, previous: number): number {
  if (Math.abs(previous) < 1e-12) return 0;
  return (current - previous) / Math.abs(previous);
}

export function computeSurvivalAnalysis(
  snapshots: KPISnapshot[],
  nSimulations = 1000,
  todayIso?: string,
): SurvivalAnalysis | null {
  if (snapshots.length < 3) return null;

  const burnRates = snapshots.map((s) => s.burnRate);
  const mrrValues = snapshots.map((s) => s.mrr);
  const netWeekly = burnRates.map((b) => -b); // all <= 0

  const mu = mean(netWeekly);
  const sigma = netWeekly.length > 1 ? stddev(netWeekly) : Math.abs(mu) * 0.2;

  const lastMrr = mrrValues[mrrValues.length - 1] > 0 ? mrrValues[mrrValues.length - 1] : 1.0;
  const totalBurned = burnRates.reduce((a, b) => a + b, 0);
  const initialCash = Math.max(lastMrr * 18.0, totalBurned * 2.0);
  const currentCash = Math.max(initialCash - totalBurned, lastMrr * 2.0);

  const rng = new SeededRng(42);
  const maxWeeks = 54;
  const zeroCashDays: number[] = [];
  let ruin90 = 0;
  let ruin180 = 0;
  let ruin365 = 0;

  for (let sim = 0; sim < nSimulations; sim++) {
    let cash = currentCash;
    let exhaustedAtDays: number | null = null;
    for (let week = 1; week <= maxWeeks; week++) {
      const weeklyChange = rng.normal(mu, Math.max(sigma, 1.0));
      cash += weeklyChange;
      if (cash <= 0 && exhaustedAtDays === null) exhaustedAtDays = week * 7;
    }
    const days = exhaustedAtDays ?? maxWeeks * 7 + 1;
    zeroCashDays.push(days);
    if (days <= 90) ruin90++;
    if (days <= 180) ruin180++;
    if (days <= 365) ruin365++;
  }

  const pRuin90 = ruin90 / nSimulations;
  const pRuin180 = ruin180 / nSimulations;
  const pRuin365 = ruin365 / nSimulations;
  const expectedZeroDay = Math.round(median(zeroCashDays));

  const survivalScore = Math.max(0, Math.min(100, Math.round((1.0 - pRuin365) * 100)));

  let label: SurvivalAnalysis["label"];
  if (survivalScore >= 80) label = "SAFE";
  else if (survivalScore >= 65) label = "LOW_RISK";
  else if (survivalScore >= 45) label = "MODERATE_RISK";
  else if (survivalScore >= 25) label = "HIGH_RISK";
  else label = "CRITICAL";

  const fundraisingDeadlineDays = expectedZeroDay - 180;
  let fundraisingDeadline: string | null = null;
  if (fundraisingDeadlineDays > 0) {
    const base = todayIso ? new Date(todayIso + "T00:00:00Z") : new Date();
    base.setUTCDate(base.getUTCDate() + fundraisingDeadlineDays);
    fundraisingDeadline = base.toISOString().slice(0, 10);
  }

  return {
    score: survivalScore,
    label,
    probabilityRuin90d: Math.round(pRuin90 * 10000) / 10000,
    probabilityRuin180d: Math.round(pRuin180 * 10000) / 10000,
    probabilityRuin365d: Math.round(pRuin365 * 10000) / 10000,
    expectedZeroCashDay: Math.min(expectedZeroDay, maxWeeks * 7),
    fundraisingDeadline,
  };
}

export function computeScenarioStressTest(snapshots: KPISnapshot[]): ScenarioResult[] {
  if (snapshots.length === 0) return [];

  const latest = snapshots[snapshots.length - 1];
  const lastMrr = Math.max(latest.mrr, 1.0);
  const lastBurn = Math.max(latest.burnRate, 0.0);

  let mrrGrowthRate: number;
  if (snapshots.length >= 4) {
    const prevMrr = Math.max(snapshots[snapshots.length - 4].mrr, 0.001);
    mrrGrowthRate = Math.max(delta(lastMrr, prevMrr) / 4.0, -0.15);
  } else if (snapshots.length >= 2) {
    const prevMrr = Math.max(snapshots[snapshots.length - 2].mrr, 0.001);
    mrrGrowthRate = Math.max(delta(lastMrr, prevMrr), -0.15);
  } else {
    mrrGrowthRate = 0.01;
  }

  const totalBurned = snapshots.reduce((a, s) => a + s.burnRate, 0);
  const initialCash = Math.max(lastMrr * 18.0, totalBurned * 2.0);
  const currentCash = Math.max(initialCash - totalBurned, lastMrr * 2.0);

  const monthsRunway = (cash: number, weeklyBurn: number): number => {
    if (weeklyBurn <= 0.0) return 99.0;
    return Math.round((cash / weeklyBurn / 4.33) * 10) / 10;
  };
  const projectedMrr6mo = (baseMrr: number, weeklyGrowth: number): number =>
    baseMrr * Math.pow(1.0 + weeklyGrowth, 26);
  const seriesAReadiness = (
    projMrr: number,
    adjBurn: number,
    weeklyGrowth: number,
  ): ScenarioResult["seriesAReadiness"] => {
    const burnMultiple = safeDiv(adjBurn * 52.0, Math.max(projMrr * weeklyGrowth * 52.0, 1.0), 99.0);
    if (projMrr >= 100_000 && burnMultiple <= 2.0) return "READY";
    if (projMrr >= 50_000 || weeklyGrowth >= 0.03) return "6_MONTHS";
    return "NOT_READY";
  };

  const scenarioParams: Array<[ScenarioResult["scenario"], number, number, number]> = [
    ["bear", 0.8, 1.15, 0.3],
    ["base", 1.0, 1.0, 1.0],
    ["bull", 1.2, 0.85, 2.5],
  ];

  const scenarios: ScenarioResult[] = [];
  for (const [scenarioName, mrrMult, burnMult, growthMult] of scenarioParams) {
    const adjMrr = lastMrr * mrrMult;
    const adjBurn = lastBurn * burnMult;
    const adjGrowth = mrrGrowthRate * growthMult;

    const months = monthsRunway(currentCash, adjBurn);
    const projMrr = projectedMrr6mo(adjMrr, adjGrowth);
    const readiness = seriesAReadiness(projMrr, adjBurn, adjGrowth);

    let keyRisks: string[];
    let recommendedActions: string[];

    if (scenarioName === "bear") {
      keyRisks = [
        `Top customer loss reduces MRR by $${(lastMrr * 0.2).toLocaleString()}/week`,
        "Increased cost pressure compresses gross margin",
        `Runway shortens from ${monthsRunway(currentCash, lastBurn).toFixed(0)} to ${months.toFixed(0)} months`,
      ];
      recommendedActions = [
        "Identify and protect top 3 revenue accounts with dedicated success plans",
        "Initiate 90-day cost reduction targeting software and marketing spend",
        "Begin fundraising conversations immediately if not already in progress",
      ];
    } else if (scenarioName === "base") {
      keyRisks =
        readiness === "NOT_READY"
          ? ["Current growth rate insufficient for Series A qualification", "Burn trajectory requires monitoring"]
          : ["Execution risk on maintaining current growth and retention rates"];
      recommendedActions = [
        "Maintain current acquisition and retention strategies with weekly KPI reviews",
        "Build 3-month pipeline of qualified enterprise prospects to accelerate MRR",
      ];
    } else {
      keyRisks = [
        "Rapid hiring ahead of revenue creates fragile burn profile",
        "Growth deceleration risk if top acquisition channels saturate",
      ];
      recommendedActions = [
        "Invest in sales capacity now to capture the growth window",
        "Build 6-month cash reserve before Series A to negotiate from strength",
        "Instrument product for expansion revenue - NRR above 120% unlocks premium multiples",
      ];
    }

    scenarios.push({
      scenario: scenarioName,
      monthsRunway: months,
      projectedMrr6mo: Math.round(projMrr * 100) / 100,
      seriesAReadiness: readiness,
      keyRisks,
      recommendedActions,
    });
  }

  return scenarios;
}

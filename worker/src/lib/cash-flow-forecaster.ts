// Ported from agents/cash_flow_forecaster.py::CashFlowForecaster (daniel-st3/ai-cfo-agent).
// N_SIMULATIONS=500, N_WEEKS=13, and all noise/drift formulas preserved verbatim.
//
// DEVIATION: the Python source reads CashBalance / CommittedExpense tables that have no
// equivalent in the live finance.* schema (issue #19646 lists only entities, revenue_ledger,
// expense_ledger, invoices, cfo_checkpoints). This port keeps the Python source's own
// *fallback* path — current cash estimated from trailing burn history — as the only path,
// since there is nothing upstream yet to populate committed expenses with. `committedExpenses`
// is accepted as an optional parameter so a future finance.committed_expenses table can be
// wired in without touching this function's math.

import type { CashFlowForecastRow, CommittedExpense, KPISnapshot } from "./types";
import { SeededRng, mean, percentile, stddev } from "./rng";

const N_SIMULATIONS = 500;
const N_WEEKS = 13;

const FREQUENCY_MULTIPLIER: Record<CommittedExpense["frequency"], number> = {
  weekly: 1.0,
  monthly: 1 / 4.33,
  quarterly: 1 / 13.0,
  annual: 1 / 52.0,
};

function weeklyEquivalent(expense: CommittedExpense): number {
  return expense.amount * (FREQUENCY_MULTIPLIER[expense.frequency] ?? 1 / 4.33);
}

function estimateCurrentCash(trailingKpis: KPISnapshot[]): number {
  if (trailingKpis.length === 0) return 200_000.0;
  const avgBurn = mean(trailingKpis.map((k) => k.burnRate));
  const avgMrr = mean(trailingKpis.map((k) => k.mrr));
  const avgNetBurn = Math.max(avgBurn - avgMrr, 0.0);
  return Math.max(avgNetBurn * 26, 50_000.0);
}

export function runCashFlowForecast(
  trailingKpis8wk: KPISnapshot[],
  committedExpenses: CommittedExpense[] = [],
  currentCashOverride?: number,
  todayIso?: string,
): {
  currentCash: number;
  totalCommittedWeekly: number;
  weeksUntilZeroP50: number | null;
  forecast: CashFlowForecastRow[];
  committedExpenses: CommittedExpense[];
} {
  const currentCash = currentCashOverride ?? estimateCurrentCash(trailingKpis8wk);

  let avgMrr = 0;
  let avgBurn = 0;
  let stdBurn = 1000.0;
  if (trailingKpis8wk.length > 0) {
    avgMrr = mean(trailingKpis8wk.map((k) => k.mrr));
    const burns = trailingKpis8wk.map((k) => k.burnRate).filter((b) => b > 0);
    avgBurn = burns.length > 0 ? mean(burns) : avgMrr * 0.4;
    stdBurn = Math.max(burns.length > 1 ? stddev(burns) : avgBurn * 0.2, avgBurn * 0.2);
  }

  const totalCommittedWeekly = committedExpenses.reduce((a, e) => a + weeklyEquivalent(e), 0);
  const variableBurn = Math.max(0.0, avgBurn - totalCommittedWeekly);

  const today = todayIso ? new Date(todayIso + "T00:00:00Z") : new Date();
  const rng = new SeededRng(42);

  const paths: number[][] = Array.from({ length: N_SIMULATIONS }, () => new Array(N_WEEKS + 1).fill(0));
  for (let s = 0; s < N_SIMULATIONS; s++) paths[s][0] = currentCash;

  const growthDrift = Array.from({ length: N_SIMULATIONS }, () => rng.uniform(-0.05, 0.15));
  const simulatedMrr = new Array(N_SIMULATIONS).fill(avgMrr);

  for (let w = 1; w <= N_WEEKS; w++) {
    const weekDate = new Date(today);
    weekDate.setUTCDate(weekDate.getUTCDate() + (w - 1) * 7);
    const committedThisWeek = totalCommittedWeekly; // committed expenses assumed flat per week (weekly-equivalent)

    for (let s = 0; s < N_SIMULATIONS; s++) {
      simulatedMrr[s] = simulatedMrr[s] * (1 + growthDrift[s]);
      const inflow = simulatedMrr[s];
      const noise = rng.normal(0, Math.max(stdBurn * 5.0, avgMrr * 0.5 + 15000));
      const variableOutflow = Math.max(variableBurn + noise, 0);
      const outflow = committedThisWeek + variableOutflow;
      const net = inflow - outflow;
      paths[s][w] = Math.max(paths[s][w - 1] + net, 0);
    }
  }

  const forecastRows: CashFlowForecastRow[] = [];
  for (let w = 1; w <= N_WEEKS; w++) {
    const weekStartDate = new Date(today);
    weekStartDate.setUTCDate(weekStartDate.getUTCDate() + (w - 1) * 7);
    const weekValues = paths.map((p) => p[w]);

    const p10 = percentile(weekValues, 10);
    const p50 = percentile(weekValues, 50);
    const p90 = percentile(weekValues, 90);

    forecastRows.push({
      weekOffset: w,
      weekStart: weekStartDate.toISOString().slice(0, 10),
      predictedBalanceP10: Math.round(p10 * 100) / 100,
      predictedBalanceP50: Math.round(p50 * 100) / 100,
      predictedBalanceP90: Math.round(p90 * 100) / 100,
      expectedInflows: Math.round(avgMrr * 100) / 100,
      expectedOutflows: Math.round((totalCommittedWeekly + variableBurn) * 100) / 100,
    });
  }

  let weeksUntilZeroP50: number | null = null;
  for (const row of forecastRows) {
    if (row.predictedBalanceP50 <= 0) {
      weeksUntilZeroP50 = row.weekOffset;
      break;
    }
  }

  return {
    currentCash: Math.round(currentCash * 100) / 100,
    totalCommittedWeekly: Math.round(totalCommittedWeekly * 100) / 100,
    weeksUntilZeroP50,
    forecast: forecastRows,
    committedExpenses,
  };
}

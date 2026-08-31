// Ported from agents/analysis.py::compute_kpi_snapshots (daniel-st3/ai-cfo-agent).
// Formulas, thresholds and weekly-bucketing logic are preserved verbatim from the Python
// source. See docs/PORTING_NOTES.md for the two documented deviations:
//   1. Category taxonomy: the live finance.expense_ledger `category` column uses free-text
//      values (e.g. "saas_subscription") rather than the Python demo's fixed CSV taxonomy
//      (salary_expense/software_expense/marketing_expense/cogs/tax_payment). classifyExpenseCategory()
//      keyword-matches into the same five buckets so the formulas below are unchanged.
//   2. sklearn IsolationForest + Chronos-T5 anomaly detection cannot run in a Workers
//      isolate (no native deps, no GPU/CPU tensor runtime). detectStatisticalAnomalies()
//      is an IQR/z-score based replacement — same anomaly *contract* (metric, severity,
//      expected range), different detection algorithm. Explicitly NOT a faithful port.

import type {
  AnomalyRecord,
  KPISnapshot,
  MetricName,
  RawFinancialRow,
} from "./types";
import { METRIC_NAMES } from "./types";
import { mean, median, quantile } from "./rng";

function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (Math.abs(denominator) < 1e-12) return fallback;
  return numerator / denominator;
}

function delta(current: number, previous: number): number {
  if (Math.abs(previous) < 1e-12) return 0;
  return (current - previous) / Math.abs(previous);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Monday of the ISO week containing `dateStr` — mirrors polars `.dt.truncate("1w")`. */
export function weekOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const isoDayOffset = day === 0 ? 6 : day - 1; // days since Monday
  d.setUTCDate(d.getUTCDate() - isoDayOffset);
  return d.toISOString().slice(0, 10);
}

const EXPENSE_BUCKET_KEYWORDS: Record<string, string[]> = {
  salary_expense: ["salary", "payroll"],
  software_expense: ["software", "saas"],
  marketing_expense: ["marketing", "ads", "advertising"],
  cogs: ["cogs", "cost_of_goods"],
  tax_payment: ["tax"],
};

export function classifyExpenseCategory(rawCategory: string): string {
  const lower = rawCategory.toLowerCase();
  for (const [bucket, keywords] of Object.entries(EXPENSE_BUCKET_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return bucket;
  }
  return "other_expense";
}

interface WeeklyBucket {
  subscriptionRevenue: number;
  churnRefund: number;
  salaryExpense: number;
  softwareExpense: number;
  marketingExpense: number;
  cogs: number;
  taxPayment: number;
  otherExpense: number;
}

function emptyBucket(): WeeklyBucket {
  return {
    subscriptionRevenue: 0,
    churnRefund: 0,
    salaryExpense: 0,
    softwareExpense: 0,
    marketingExpense: 0,
    cogs: 0,
    taxPayment: 0,
    otherExpense: 0,
  };
}

export function computeKpiSnapshots(rows: RawFinancialRow[]): KPISnapshot[] {
  if (rows.length === 0) return [];

  const weekly = new Map<string, WeeklyBucket>();
  const subFirstWeek = new Map<string, string>(); // customerId -> earliest week
  const subActiveWeeks = new Map<string, Set<string>>(); // week -> set(customerId)

  for (const row of rows) {
    const wk = weekOf(row.date);
    const bucket = weekly.get(wk) ?? emptyBucket();

    if (row.category === "subscription_revenue") {
      bucket.subscriptionRevenue += row.amount;
      if (row.customerId) {
        const prev = subFirstWeek.get(row.customerId);
        if (!prev || wk < prev) subFirstWeek.set(row.customerId, wk);
        if (!subActiveWeeks.has(wk)) subActiveWeeks.set(wk, new Set());
        subActiveWeeks.get(wk)!.add(row.customerId);
      }
    } else if (row.category === "churn_refund") {
      bucket.churnRefund += row.amount;
    } else {
      const b = classifyExpenseCategory(row.category);
      if (b === "salary_expense") bucket.salaryExpense += row.amount;
      else if (b === "software_expense") bucket.softwareExpense += row.amount;
      else if (b === "marketing_expense") bucket.marketingExpense += row.amount;
      else if (b === "cogs") bucket.cogs += row.amount;
      else if (b === "tax_payment") bucket.taxPayment += row.amount;
      else bucket.otherExpense += row.amount;
    }
    weekly.set(wk, bucket);
  }

  const newCustomersByWeek = new Map<string, number>();
  for (const wk of subFirstWeek.values()) {
    newCustomersByWeek.set(wk, (newCustomersByWeek.get(wk) ?? 0) + 1);
  }

  const sortedWeeks = [...weekly.keys()].sort();
  const snapshots: KPISnapshot[] = [];
  const hist: Record<MetricName, number>[] = [];

  for (const wk of sortedWeeks) {
    const b = weekly.get(wk)!;
    const revenue = b.subscriptionRevenue;
    const churnAbs = Math.abs(b.churnRefund);
    const salary = Math.abs(b.salaryExpense);
    const software = Math.abs(b.softwareExpense);
    const marketing = Math.abs(b.marketingExpense);
    const cogs = Math.abs(b.cogs);
    const taxes = Math.abs(b.taxPayment);
    const other = Math.abs(b.otherExpense);
    const newCustomers = newCustomersByWeek.get(wk) ?? 0;
    const activeCustomerCount = Math.max(subActiveWeeks.get(wk)?.size ?? 1, 1);

    const expensesTotal = salary + software + marketing + cogs + taxes + other;

    const mrr = Math.max(revenue - churnAbs, 0);
    const arr = mrr * 12.0;
    const churnRate = Math.min(safeDiv(churnAbs, revenue, 0), 1);
    const burnRate = Math.max(expensesTotal - revenue, 0);
    const grossMargin = safeDiv(revenue - cogs, revenue, 0);
    const cac = safeDiv(marketing, newCustomers, 0);
    const arpuWeekly = safeDiv(revenue, activeCustomerCount, 0);
    const arpuAnnual = arpuWeekly * 52.0;

    const recentChurn = hist.slice(-12).map((h) => h.churn_rate);
    const trailingChurnWeekly =
      hist.length >= 4 ? mean(recentChurn) : Math.max(churnRate, 0.001);
    const annualChurn = Math.max(trailingChurnWeekly * 52.0, 0.05);
    const ltv = safeDiv(arpuAnnual * Math.max(grossMargin, 0.01), annualChurn, 0);

    const metrics: Record<MetricName, number> = {
      mrr,
      arr,
      churn_rate: churnRate,
      burn_rate: burnRate,
      gross_margin: grossMargin,
      cac,
      ltv,
    };
    hist.push(metrics);

    const zeroMetrics: Record<MetricName, number> = {
      mrr: 0,
      arr: 0,
      churn_rate: 0,
      burn_rate: 0,
      gross_margin: 0,
      cac: 0,
      ltv: 0,
    };
    const previous = hist.length >= 2 ? hist[hist.length - 2] : zeroMetrics;
    const monthBack = hist.length >= 5 ? hist[hist.length - 5] : zeroMetrics;

    const wowDelta = {} as Record<MetricName, number>;
    const momDelta = {} as Record<MetricName, number>;
    for (const name of METRIC_NAMES) {
      wowDelta[name] = round4(delta(metrics[name], previous[name]));
      momDelta[name] = round4(delta(metrics[name], monthBack[name]));
    }

    snapshots.push({
      weekStart: wk,
      mrr,
      arr,
      churnRate,
      burnRate,
      grossMargin,
      cac,
      ltv,
      wowDelta,
      momDelta,
    });
  }

  return snapshots;
}

/**
 * Statistical outlier detection — REPLACES sklearn IsolationForest + Chronos-T5.
 * Not a faithful port (see file header). Flags a week's metric value as an outlier
 * when it falls outside [Q1 - 1.5*IQR, Q3 + 1.5*IQR] of the metric's own history,
 * severity scaled by how many IQRs outside the fence the value sits.
 */
export function detectStatisticalAnomalies(snapshots: KPISnapshot[]): AnomalyRecord[] {
  const anomalies: AnomalyRecord[] = [];
  if (snapshots.length < 8) return anomalies;

  const getMetric = (s: KPISnapshot, name: MetricName): number => {
    switch (name) {
      case "mrr": return s.mrr;
      case "arr": return s.arr;
      case "churn_rate": return s.churnRate;
      case "burn_rate": return s.burnRate;
      case "gross_margin": return s.grossMargin;
      case "cac": return s.cac;
      case "ltv": return s.ltv;
    }
  };

  for (const name of METRIC_NAMES) {
    const values = snapshots.map((s) => getMetric(s, name));
    if (values.every((v) => v === values[0])) continue;

    const q1 = quantile(values, 0.25);
    const q3 = quantile(values, 0.75);
    const iqr = q3 - q1;
    const lowFence = q1 - 1.5 * iqr;
    const highFence = q3 + 1.5 * iqr;
    const lowQ = quantile(values, 0.1);
    const medQ = median(values);
    const highQ = quantile(values, 0.9);

    values.forEach((value, idx) => {
      if (iqr <= 1e-9) return;
      let strength = 0;
      if (value < lowFence) strength = (lowFence - value) / Math.max(iqr, 1e-9);
      else if (value > highFence) strength = (value - highFence) / Math.max(iqr, 1e-9);
      else return;

      const severity = strength >= 2 ? "HIGH" : strength >= 1 ? "MEDIUM" : "LOW";
      anomalies.push({
        metric: name,
        actualValue: Math.round(value * 10000) / 10000,
        expectedRange: { low: lowQ, median: medQ, high: highQ },
        severity,
        source: "statistical_outlier",
        description: `Statistical (IQR) outlier in ${name} for week ${snapshots[idx].weekStart}`,
      });
    });
  }

  return anomalies;
}

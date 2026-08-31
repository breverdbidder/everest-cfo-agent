// Ported verbatim (formulas + thresholds) from agents/analysis.py::detect_fraud_patterns
// and ::compute_customer_profiles (daniel-st3/ai-cfo-agent). No algorithmic substitution
// needed here — these are pure rule-based / arithmetic checks, fully portable to Workers.

import type { CustomerProfileRecord, FraudAlertRecord, RawFinancialRow } from "./types";
import { weekOf } from "./kpi-engine";
import { median } from "./rng";

const EXPENSE_CATS = new Set(["subscription_revenue", "churn_refund"]);

export function detectFraudPatterns(rows: RawFinancialRow[]): FraudAlertRecord[] {
  const weekly = new Map<string, Map<string, number[]>>(); // week -> category -> amounts
  for (const row of rows) {
    const wk = weekOf(row.date);
    if (!weekly.has(wk)) weekly.set(wk, new Map());
    const catMap = weekly.get(wk)!;
    if (!catMap.has(row.category)) catMap.set(row.category, []);
    catMap.get(row.category)!.push(row.amount);
  }
  const sortedWeeks = [...weekly.keys()].sort();

  // Per-category weekly totals, in week order
  const catWeekly = new Map<string, Array<[string, number]>>();
  for (const wk of sortedWeeks) {
    for (const [cat, amts] of weekly.get(wk)!.entries()) {
      if (!catWeekly.has(cat)) catWeekly.set(cat, []);
      catWeekly.get(cat)!.push([wk, amts.reduce((a, b) => a + b, 0)]);
    }
  }

  const alerts: FraudAlertRecord[] = [];

  // Rule 1: round_number — expense amounts exactly divisible by 1000 (>= $1000)
  for (const row of rows) {
    if (EXPENSE_CATS.has(row.category)) continue;
    const amt = Math.abs(row.amount);
    if (amt >= 1000 && amt % 1000 === 0) {
      alerts.push({
        weekStart: weekOf(row.date),
        category: row.category,
        pattern: "round_number",
        severity: "HIGH",
        amount: row.amount,
        description:
          `Perfectly round $${amt.toLocaleString()} in ${row.category} on ${row.date}. ` +
          "Round numbers may indicate fictitious or manually entered transactions.",
      });
    }
  }

  // Rule 2: velocity_spike — weekly category total > 3x 8-week rolling median
  for (const [cat, totals] of catWeekly.entries()) {
    if (totals.length < 4) continue;
    totals.forEach(([wk, total], i) => {
      const lookback = totals.slice(Math.max(0, i - 8), i).map(([, t]) => t);
      if (lookback.length < 2) return;
      const med = median(lookback);
      if (med === 0) return;
      if (Math.abs(total) > 3 * Math.abs(med)) {
        alerts.push({
          weekStart: wk,
          category: cat,
          pattern: "velocity_spike",
          severity: "HIGH",
          amount: Math.round(total * 10000) / 10000,
          description:
            `${cat} spike: $${Math.abs(total).toLocaleString()} vs $${Math.abs(med).toLocaleString()} rolling median ` +
            `(${(Math.abs(total) / Math.abs(med)).toFixed(1)}x). Possible unauthorized spend.`,
        });
      }
    });
  }

  // Rule 3: duplicate_amount — same amount + category 2+ times in same week
  for (const wk of sortedWeeks) {
    for (const [cat, amts] of weekly.get(wk)!.entries()) {
      const seen = new Map<string, number>();
      for (const a of amts) {
        const key = a.toFixed(4);
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      for (const [key, count] of seen.entries()) {
        if (count >= 2) {
          alerts.push({
            weekStart: wk,
            category: cat,
            pattern: "duplicate_amount",
            severity: "MEDIUM",
            amount: Number(key),
            description:
              `$${Number(key).toLocaleString(undefined, { minimumFractionDigits: 2 })} appears ${count}x in ${cat} during week ${wk}. ` +
              "Possible duplicate or split transaction.",
          });
        }
      }
    }
  }

  // Rule 4: zero_revenue_week — zero revenue but above-median expenses
  const allExpenseTotals = sortedWeeks.map((wk) => {
    let total = 0;
    for (const [cat, amts] of weekly.get(wk)!.entries()) {
      if (EXPENSE_CATS.has(cat)) continue;
      total += amts.reduce((a, v) => a + Math.abs(v), 0);
    }
    return total;
  });
  if (allExpenseTotals.length >= 4) {
    const medianExpense = median(allExpenseTotals);
    for (const wk of sortedWeeks) {
      const catMap = weekly.get(wk)!;
      const revenue = (catMap.get("subscription_revenue") ?? []).reduce((a, b) => a + b, 0);
      let expense = 0;
      for (const [cat, amts] of catMap.entries()) {
        if (EXPENSE_CATS.has(cat)) continue;
        expense += amts.reduce((a, v) => a + Math.abs(v), 0);
      }
      if (revenue === 0 && expense > medianExpense) {
        alerts.push({
          weekStart: wk,
          category: "subscription_revenue",
          pattern: "zero_revenue_week",
          severity: "MEDIUM",
          amount: 0,
          description:
            `Zero revenue week ${wk} with $${expense.toLocaleString()} in expenses ` +
            `(median: $${medianExpense.toLocaleString()}). Revenue recognition gap or data issue.`,
        });
      }
    }
  }

  // Rule 5: contractor_ratio — contractor > 2.5x salary in a week
  for (const wk of sortedWeeks) {
    const catMap = weekly.get(wk)!;
    const contractor = Math.abs((catMap.get("contractor_expense") ?? []).reduce((a, b) => a + b, 0));
    const salary = Math.abs((catMap.get("salary_expense") ?? []).reduce((a, b) => a + b, 0));
    if (salary > 0 && contractor / salary > 2.5) {
      alerts.push({
        weekStart: wk,
        category: "contractor_expense",
        pattern: "contractor_ratio",
        severity: "LOW",
        amount: Math.round(contractor * 10000) / 10000,
        description:
          `Contractors $${contractor.toLocaleString()} = ${(contractor / salary).toFixed(1)}x salary $${salary.toLocaleString()} ` +
          `(week ${wk}). High ratio may indicate misclassification.`,
      });
    }
  }

  // Deduplicate: keep first occurrence per (week, category, pattern)
  const seenKeys = new Set<string>();
  const deduped: FraudAlertRecord[] = [];
  for (const a of alerts) {
    const key = `${a.weekStart}|${a.category}|${a.pattern}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      deduped.push(a);
    }
  }
  return deduped;
}

export function computeCustomerProfiles(rows: RawFinancialRow[]): CustomerProfileRecord[] {
  const customerWeeks = new Map<string, Set<string>>();
  const customerRevenue = new Map<string, number>();
  const customerFirst = new Map<string, string>();
  const customerLast = new Map<string, string>();
  const churned = new Set<string>();

  for (const row of rows) {
    if (!row.customerId) continue;
    const cid = row.customerId;
    if (row.category === "subscription_revenue") {
      if (!customerWeeks.has(cid)) customerWeeks.set(cid, new Set());
      customerWeeks.get(cid)!.add(row.date);
      customerRevenue.set(cid, (customerRevenue.get(cid) ?? 0) + row.amount);
      if (!customerFirst.has(cid) || row.date < customerFirst.get(cid)!) customerFirst.set(cid, row.date);
      if (!customerLast.has(cid) || row.date > customerLast.get(cid)!) customerLast.set(cid, row.date);
    } else if (row.category === "churn_refund") {
      churned.add(cid);
    }
  }

  if (customerRevenue.size === 0) return [];

  const totalRevenue = [...customerRevenue.values()].reduce((a, b) => a + b, 0);

  const profiles: CustomerProfileRecord[] = [];
  for (const [cid, revenue] of customerRevenue.entries()) {
    const weeksActive = customerWeeks.get(cid)?.size ?? 0;
    const avgWeekly = revenue / Math.max(weeksActive, 1);

    let segment: CustomerProfileRecord["segment"] = "SMB";
    if (avgWeekly > 500) segment = "Enterprise";
    else if (avgWeekly > 150) segment = "Mid";

    profiles.push({
      customerId: cid,
      totalRevenue: Math.round(revenue * 100) / 100,
      weeksActive,
      avgWeeklyRevenue: Math.round(avgWeekly * 100) / 100,
      firstSeen: customerFirst.get(cid) ?? new Date().toISOString().slice(0, 10),
      lastSeen: customerLast.get(cid) ?? new Date().toISOString().slice(0, 10),
      churnFlag: churned.has(cid),
      segment,
      revenuePct: totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 10000) / 10000 : 0,
    });
  }

  return profiles.sort((a, b) => b.totalRevenue - a.totalRevenue);
}

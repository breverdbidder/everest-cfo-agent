// Shared types for the ported KPI / fraud / survival / forecast engines.
// Mirrors api/models.py (RawFinancial, KPISnapshot, Anomaly, FraudAlertRecord, CustomerProfileRecord)
// from the upstream Python source, adapted for the live finance.* / winnerdata.* schema.

export interface RawFinancialRow {
  date: string; // ISO yyyy-mm-dd
  category: string;
  amount: number; // dollars, signed as in Python source (expenses negative-or-abs per rule)
  customerId: string | null;
}

export const METRIC_NAMES = [
  "mrr",
  "arr",
  "churn_rate",
  "burn_rate",
  "gross_margin",
  "cac",
  "ltv",
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

export interface KPISnapshot {
  weekStart: string; // ISO date, Monday of week
  mrr: number;
  arr: number;
  churnRate: number;
  burnRate: number;
  grossMargin: number;
  cac: number;
  ltv: number;
  wowDelta: Record<MetricName, number>;
  momDelta: Record<MetricName, number>;
}

export type Severity = "LOW" | "MEDIUM" | "HIGH";

export interface AnomalyRecord {
  metric: MetricName;
  actualValue: number;
  expectedRange: { low: number; median: number; high: number };
  severity: Severity;
  source: "statistical_outlier"; // see docs/PORTING_NOTES.md — sklearn IsolationForest/Chronos not portable to Workers
  description: string;
}

export type FraudPattern =
  | "round_number"
  | "velocity_spike"
  | "duplicate_amount"
  | "zero_revenue_week"
  | "contractor_ratio";

export interface FraudAlertRecord {
  weekStart: string;
  category: string;
  pattern: FraudPattern;
  severity: Severity;
  amount: number;
  description: string;
}

export interface CustomerProfileRecord {
  customerId: string;
  totalRevenue: number;
  weeksActive: number;
  avgWeeklyRevenue: number;
  firstSeen: string;
  lastSeen: string;
  churnFlag: boolean;
  segment: "Enterprise" | "Mid" | "SMB";
  revenuePct: number;
}

export interface SurvivalAnalysis {
  score: number;
  label: "SAFE" | "LOW_RISK" | "MODERATE_RISK" | "HIGH_RISK" | "CRITICAL";
  probabilityRuin90d: number;
  probabilityRuin180d: number;
  probabilityRuin365d: number;
  expectedZeroCashDay: number;
  fundraisingDeadline: string | null;
}

export interface ScenarioResult {
  scenario: "bear" | "base" | "bull";
  monthsRunway: number;
  projectedMrr6mo: number;
  seriesAReadiness: "READY" | "6_MONTHS" | "NOT_READY";
  keyRisks: string[];
  recommendedActions: string[];
}

export interface HealthScoreResult {
  score: number;
  status: "healthy" | "warning" | "critical";
  reasoning: string;
  components: {
    runway: number;
    burnStability: number;
    revenueGrowth: number;
    unitEconomics: number;
    riskFactors: number;
  };
  cached: boolean;
  timestamp: string;
}

export interface CommittedExpense {
  id: string;
  name: string;
  amount: number;
  frequency: "weekly" | "monthly" | "quarterly" | "annual";
  nextPaymentDate: string;
  category: string;
}

export interface CashFlowForecastRow {
  weekOffset: number;
  weekStart: string;
  predictedBalanceP10: number;
  predictedBalanceP50: number;
  predictedBalanceP90: number;
  expectedInflows: number;
  expectedOutflows: number;
}

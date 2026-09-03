// Frontend response shapes -- mirror the backend types in src/lib/viz-aggregate.ts and
// src/lib/entities.ts exactly (kept as a hand-written mirror rather than a shared import
// because the webapp and Worker are two separate TS projects/tsconfigs -- see esbuild.config.mjs).

export const ENTITY_CODES = [
  "everest_capital_brevard",
  "everest_capital",
  "biddeed",
  "zonewise",
  "winnerdata",
  "protection_partners",
  "ariel_personal",
] as const;
export type EntityCode = (typeof ENTITY_CODES)[number];

export const ENTITY_LABELS: Record<EntityCode, string> = {
  everest_capital_brevard: "Everest Capital of Brevard",
  everest_capital: "Everest Capital USA",
  biddeed: "BidDeed",
  zonewise: "ZoneWise",
  winnerdata: "Winner Data",
  protection_partners: "Protection Partners",
  ariel_personal: "Personal (Ariel)",
};

export type EntitySelection = "all" | EntityCode;
export type Grain = "day" | "week" | "month";
export type Preset = "30d" | "90d" | "ytd" | "all" | "custom";

export interface BankAccount {
  id: string;
  name: string;
  mask: string | null;
  entity_code: EntityCode;
  current_balance_cents: number | null;
  data_source: "REAL" | "FIXTURE";
}

export interface CashSeriesPoint {
  date: string;
  byAccount: Record<string, number>;
  total_cents: number;
}

export interface CashResponse {
  entity: string;
  grain: Grain;
  from: string;
  to: string;
  accounts: BankAccount[];
  series: CashSeriesPoint[];
  asOf: string;
}

export interface CashflowBucket {
  bucket: string;
  inflow_cents: number;
  outflow_cents: number;
  net_cents: number;
}

export interface CashflowResponse {
  entity: string;
  grain: Grain;
  from: string;
  to: string;
  buckets: CashflowBucket[];
}

export interface BurnMonth {
  month: string;
  expense_cents: number;
}

export interface BurnResponse {
  entity: string;
  months: BurnMonth[];
  recurringMonthlyRunrateDollars: number;
  avg3MoBurnCents: number;
  cashOnHandCents: number;
  runwayMonths: number | null;
}

export interface CategoryBreakdown {
  account_code: string;
  account_name: string;
  amount_cents: number;
}

export interface VendorBreakdown {
  vendor: string;
  amount_cents: number;
  occurrences: number;
}

export interface CategoriesResponse {
  entity: string;
  from: string;
  to: string;
  categories: CategoryBreakdown[];
  topVendors: VendorBreakdown[];
}

export interface RecurringCostRow {
  entity_code: string;
  vendor: string;
  account_code: string;
  account_name: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  cadence: string;
  last_amount_dollars: number;
  monthly_runrate_dollars: number | null;
}

export interface CommingledCostRow {
  txn_date: string;
  vendor_description: string;
  amount_dollars: number;
  likely_business_entity: string | null;
  note: string;
  suggested_reclass: string;
  bank_transaction_id: string;
  journal_entry_id: string;
}

export interface ReconExceptionRow {
  exception_id: string;
  entity_code: string | null;
  reason: string;
  status: string;
  txn_date: string | null;
  amount_cents: number;
  description: string | null;
  data_source: "REAL" | "FIXTURE";
  opened_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

export interface ChatAnswer {
  answer: string;
  numbers: Record<string, unknown>;
  sql: string;
  refused: boolean;
  entity: string;
}

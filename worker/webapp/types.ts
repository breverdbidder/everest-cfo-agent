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

export interface CfoDailyCloseRow {
  id: string;
  run_at: string;
  status: string;
  exceptions_open: number;
  unbalanced_count: number;
  duration_ms: number | null;
  error: string | null;
}

export interface CloseLatestResponse {
  latest: CfoDailyCloseRow | null;
}

export interface ChatAnswer {
  answer: string;
  numbers: Record<string, unknown>;
  sql: string;
  refused: boolean;
  entity: string;
}

// Issue #19810 CFO v1 Issue M -- invoice audit. Mirrors worker/src/lib/vendorInvoices.ts.
export type InvoiceStatus = "received" | "verified" | "disputed" | "paid" | "credited";

export interface VendorInvoiceRow {
  id: string;
  vendor: string;
  invoice_number: string;
  issued_on: string;
  due_on: string | null;
  currency: string;
  subtotal_cents: number | null;
  total_cents: number;
  entity_code: string | null;
  status: InvoiceStatus;
  source_file: string | null;
  extraction_method: string | null;
  bank_transaction_id: string | null;
  dispute_draft: string | null;
  dispute_draft_at: string | null;
  created_at: string;
}

export interface VendorInvoiceLineRow {
  id: string;
  invoice_id: string;
  description: string;
  qty: number | null;
  unit_price_cents: number | null;
  amount_cents: number;
  metric_name: string | null;
  verified_qty: number | null;
  variance_pct: number | null;
  verdict: string | null;
  evidence: Record<string, unknown> | null;
}

export interface AnomalyFinding {
  rule: string;
  line_id?: string;
  reason: string;
}

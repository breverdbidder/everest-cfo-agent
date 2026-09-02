// Data layer — reads live finance.* / winnerdata.* tables from Supabase mocerqjnksmhcjzxrewo
// via @supabase/supabase-js. Auth is split across two headers, per issue #19710:
//   apikey        — the project's legacy `anon` key (Kong gateway auth only; anon itself has
//                    zero grants on finance/winnerdata, so holding this is not a privilege risk)
//   Authorization — a long-lived, self-signed HS256 JWT ({role: "cfo_agent_ro", iss: "supabase"})
//                    signed with the project's legacy jwt_secret, which is what actually
//                    determines the effective Postgres role for RLS/grants.
// This replaces the Management-API-minted "secret" key (secret_jwt_template bound to
// cfo_agent_ro) from the original #19646 session — that key type proved to authenticate
// inconsistently depending on network origin (worked from some GitHub Actions runners,
// 401 "Invalid API key" from others and from this Worker's own Cloudflare edge, on the
// exact same key value, at the same time). The anon+JWT split uses only the legacy
// JWT-verification code path, which was verified consistent across all three origins.
// See worker/docs/PORTING_NOTES.md for the full investigation and the RLS policies
// (`cfo_agent_ro_select`) that had to be added alongside this for scoped reads to return
// any rows at all.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CustomerProfileRecord, RawFinancialRow } from "./types";

export interface CfoEnv {
  CFO_AGENT_SUPABASE_URL: string;
  CFO_AGENT_SUPABASE_ANON_KEY: string;
  CFO_AGENT_SUPABASE_KEY: string;
  CFO_AGENT_SHARED_SECRET: string;
  DEEPSEEK_API_KEY?: string;
}

export function getSupabaseClient(env: CfoEnv): SupabaseClient {
  return createClient(env.CFO_AGENT_SUPABASE_URL, env.CFO_AGENT_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${env.CFO_AGENT_SUPABASE_KEY}` } },
  });
}

export interface RevenueLedgerRow {
  id: string;
  occurred_on: string;
  entity_code: string | null;
  customer: string;
  source: string;
  amount_cents: number;
  status: string;
}

export interface ExpenseLedgerRow {
  id: string;
  incurred_on: string;
  entity_code: string | null;
  vendor: string;
  category: string;
  amount_cents: number;
  is_recurring: boolean | null;
  recurrence_period: string | null;
  source: string | null;
}

export interface CfoCheckpointRow {
  id: string;
  checkpoint: string;
  status: string;
  evidence: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillableFFEventRow {
  id: string;
  lead_id: string | null;
  org_id: string;
  producer_id: string | null;
  delivered_at: string;
  monetization_tier_met: boolean;
  bound_at: string | null;
  scenario_a_delivery_fee_cents: number;
  scenario_a_success_fee_cents: number;
  scenario_b_flat_fee_cents: number;
  source_batch_date: string | null;
}

export interface WalletRow {
  org_id: string;
  balance_cents: number;
  daily_burn_estimate_cents: number;
  auto_replenish_threshold_days: number;
  hard_stopped: boolean;
  updated_at: string;
}

/**
 * Loads finance.revenue_ledger (status='invoiced' only — REAL/booked revenue, matching the
 * dashboard's REAL-vs-PROJECTED distinction from issue #19646 item 7; 'pending' rows are
 * exposed separately via listRevenueLedger()) and finance.expense_ledger, mapped into the
 * RawFinancialRow shape the ported KPI/fraud/survival engines expect.
 */
export async function loadRawFinancialRows(client: SupabaseClient): Promise<RawFinancialRow[]> {
  const [{ data: revenue, error: revErr }, { data: expenses, error: expErr }] = await Promise.all([
    client.schema("finance").from("revenue_ledger").select("occurred_on, customer, amount_cents, status").eq("status", "invoiced"),
    client.schema("finance").from("expense_ledger").select("incurred_on, category, amount_cents"),
  ]);
  if (revErr) throw new Error(`revenue_ledger read failed: ${revErr.message}`);
  if (expErr) throw new Error(`expense_ledger read failed: ${expErr.message}`);

  const rows: RawFinancialRow[] = [];
  for (const r of revenue ?? []) {
    rows.push({
      date: r.occurred_on,
      category: "subscription_revenue",
      amount: r.amount_cents / 100,
      customerId: r.customer,
    });
  }
  for (const e of expenses ?? []) {
    rows.push({
      date: e.incurred_on,
      category: e.category,
      amount: e.amount_cents / 100,
      customerId: null,
    });
  }
  return rows;
}

export async function listRevenueLedger(client: SupabaseClient, limit = 50): Promise<RevenueLedgerRow[]> {
  const { data, error } = await client
    .schema("finance")
    .from("revenue_ledger")
    .select("id, occurred_on, entity_code, customer, source, amount_cents, status")
    .order("occurred_on", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`revenue_ledger list failed: ${error.message}`);
  return data ?? [];
}

export async function listExpenseLedger(client: SupabaseClient, limit = 50): Promise<ExpenseLedgerRow[]> {
  const { data, error } = await client
    .schema("finance")
    .from("expense_ledger")
    .select("id, incurred_on, entity_code, vendor, category, amount_cents, is_recurring, recurrence_period, source")
    .order("incurred_on", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`expense_ledger list failed: ${error.message}`);
  return data ?? [];
}

export async function listCheckpoints(client: SupabaseClient): Promise<CfoCheckpointRow[]> {
  const { data, error } = await client
    .schema("finance")
    .from("cfo_checkpoints")
    .select("id, checkpoint, status, evidence, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`cfo_checkpoints list failed: ${error.message}`);
  return data ?? [];
}

export async function listBillableFFEvents(client: SupabaseClient, limit = 50): Promise<BillableFFEventRow[]> {
  const { data, error } = await client
    .schema("winnerdata")
    .from("billable_ff_events")
    .select(
      "id, lead_id, org_id, producer_id, delivered_at, monetization_tier_met, bound_at, scenario_a_delivery_fee_cents, scenario_a_success_fee_cents, scenario_b_flat_fee_cents, source_batch_date",
    )
    .order("delivered_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`billable_ff_events list failed: ${error.message}`);
  return data ?? [];
}

export async function listBillableFFComparison(client: SupabaseClient, limit = 50) {
  const { data, error } = await client
    .schema("winnerdata")
    .from("v_billable_ff_comparison")
    .select("*")
    .order("delivered_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`v_billable_ff_comparison list failed: ${error.message}`);
  return data ?? [];
}

export async function listWallets(client: SupabaseClient): Promise<WalletRow[]> {
  const { data, error } = await client
    .schema("winnerdata")
    .from("wallets")
    .select("org_id, balance_cents, daily_burn_estimate_cents, auto_replenish_threshold_days, hard_stopped, updated_at");
  if (error) throw new Error(`wallets list failed: ${error.message}`);
  return data ?? [];
}

export function toCustomerProfileMap(profiles: CustomerProfileRecord[]): Record<string, CustomerProfileRecord> {
  return Object.fromEntries(profiles.map((p) => [p.customerId, p]));
}

export interface ReconSummaryRow {
  entity_code: string;
  period: string;
  bank_rows: number;
  matched: number;
  matched_pct: number | null;
  exceptions_open: number;
  ledger_balance_cents: number | null;
  bank_balance_cents: number | null;
  variance_cents: number;
  data_source: "REAL" | "FIXTURE" | "MIXED";
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

/** Issue #19738 CP6/CP7 -- bank reconciliation summary, entity/period rollup. */
export async function listReconSummary(client: SupabaseClient): Promise<ReconSummaryRow[]> {
  const { data, error } = await client
    .schema("finance")
    .from("v_recon_summary")
    .select("*")
    .order("entity_code", { ascending: true })
    .order("period", { ascending: true });
  if (error) throw new Error(`v_recon_summary list failed: ${error.message}`);
  return data ?? [];
}

/** Issue #19738 CP6/CP7 -- open + resolved reconciliation exceptions. */
export async function listReconExceptions(client: SupabaseClient, limit = 100): Promise<ReconExceptionRow[]> {
  const { data, error } = await client
    .schema("finance")
    .from("v_recon_exceptions")
    .select("*")
    .order("opened_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`v_recon_exceptions list failed: ${error.message}`);
  return data ?? [];
}

export interface RecurringCostRow {
  entity_code: string;
  vendor: string;
  account_code: string;
  account_name: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  cadence: "monthly" | "weekly" | "quarterly" | "irregular" | "single_occurrence";
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

/** Issue #19755 CFO v1 Issue G -- recurring cost register (finance.v_recurring_costs). Feeds
 * runway/burn once wired into the KPI engine (not done here -- issue scope is the register
 * + dashboard section only, per K2/scope discipline). */
export async function listRecurringCosts(client: SupabaseClient): Promise<RecurringCostRow[]> {
  const { data, error } = await client
    .schema("finance")
    .from("v_recurring_costs")
    .select("*")
    .order("entity_code", { ascending: true })
    .order("monthly_runrate_dollars", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`v_recurring_costs list failed: ${error.message}`);
  return data ?? [];
}

/** Issue #19755 CFO v1 Issue G -- business infra/SaaS paid from ariel_personal
 * (finance.v_commingled_business_costs). Tier 1 propose-only -- never auto-reclassed. */
export async function listCommingledCosts(client: SupabaseClient): Promise<CommingledCostRow[]> {
  const { data, error } = await client
    .schema("finance")
    .from("v_commingled_business_costs")
    .select("*")
    .order("txn_date", { ascending: false });
  if (error) throw new Error(`v_commingled_business_costs list failed: ${error.message}`);
  return data ?? [];
}

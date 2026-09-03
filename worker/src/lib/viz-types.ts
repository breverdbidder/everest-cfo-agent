// Shared row shapes for the viz layer (issue #19764), matching finance.* columns exactly
// (see worker/docs/PORTING_NOTES.md for the schema). Split from viz.ts so the pure
// aggregation functions in viz-aggregate.ts can import types without pulling in the
// Supabase client.

import type { EntityCode } from "./entities";

export interface RawBankAccount {
  id: string;
  name: string;
  mask: string | null;
  entity_code: EntityCode;
  current_balance_cents: number | null;
  data_source: "REAL" | "FIXTURE";
}

export interface RawBankTxn {
  id: string;
  bank_account_id: string;
  amount_cents: number;
  posted_on: string;
  name: string | null;
  merchant_name: string | null;
  category: string[] | null;
}

export interface RawPosting {
  id: string;
  entry_id: string;
  account_id: string;
  debit_cents: number;
  credit_cents: number;
}

export interface RawJournalEntry {
  id: string;
  entity_code: EntityCode;
  entry_date: string;
  ref_table: string | null;
  ref_id: string | null;
}

export interface RawLedgerAccount {
  id: string;
  entity_code: EntityCode | null;
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
}

// A "Transfer"/"Payment" category (Plaid taxonomy, category[0]) means money moving between
// two accounts we already track -- excluded from cashflow inflow/outflow so it isn't
// double-counted as external revenue/spend.
export const NON_CASHFLOW_CATEGORY_PREFIXES = new Set(["Transfer", "Payment"]);

export function isTransferLike(category: string[] | null): boolean {
  return !!category && category.length > 0 && NON_CASHFLOW_CATEGORY_PREFIXES.has(category[0]);
}

/** Everything getVizData() fetches in one pass, shared across all /api/viz/* handlers. */
export interface VizDataBundle {
  accounts: RawBankAccount[];
  bankTxns: RawBankTxn[];
  postings: RawPosting[];
  journalEntries: RawJournalEntry[];
  ledgerAccounts: RawLedgerAccount[];
}

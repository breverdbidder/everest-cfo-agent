// Data layer for the viz endpoints (issue #19764) -- reads finance.bank_accounts,
// finance.bank_transactions, finance.journal_entries, finance.postings, finance.accounts
// through the same cfo_agent_ro-scoped Supabase client as lib/supabase.ts. Kept in its own
// file (rather than growing supabase.ts further) because these six queries feed a
// self-contained aggregation stage (viz-aggregate.ts) that the ledger/recon reads don't.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isEntityCode, type EntityCode } from "./entities";
import type { RawBankAccount, RawBankTxn, RawJournalEntry, RawLedgerAccount, RawPosting } from "./viz-types";

export async function listVizBankAccounts(client: SupabaseClient): Promise<RawBankAccount[]> {
  const { data, error } = await client
    .schema("finance")
    .from("bank_accounts")
    .select("id, name, mask, current_balance_cents, ledger_account_id");
  if (error) throw new Error(`bank_accounts list failed: ${error.message}`);

  const ledgerIds = (data ?? []).map((r) => r.ledger_account_id).filter(Boolean);
  const ledgerByIdEntity = await lookupEntityCodesByAccountId(client, ledgerIds);

  return (data ?? [])
    .map((r) => ({
      id: r.id as string,
      name: r.name as string,
      mask: r.mask as string | null,
      entity_code: r.ledger_account_id ? ledgerByIdEntity.get(r.ledger_account_id as string) ?? null : null,
      current_balance_cents: r.current_balance_cents as number | null,
      data_source: (r.current_balance_cents === null ? "FIXTURE" : "REAL") as "REAL" | "FIXTURE",
    }))
    .filter((r): r is RawBankAccount => isEntityCode(r.entity_code));
}

async function lookupEntityCodesByAccountId(client: SupabaseClient, ids: string[]): Promise<Map<string, EntityCode>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await client.schema("finance").from("accounts").select("id, entity_code").in("id", ids);
  if (error) throw new Error(`accounts lookup failed: ${error.message}`);
  const m = new Map<string, EntityCode>();
  for (const r of data ?? []) {
    if (isEntityCode(r.entity_code)) m.set(r.id as string, r.entity_code);
  }
  return m;
}

/** Fetches every bank_transactions row once (676 rows as of 2026-09-02, well under
 * PostgREST's max_rows=1000) so both the cash-series builder (filters by account_id
 * client-side) and the category/vendor breakdown (looks up by id) share a single fetch
 * instead of each issuing large `.in()` filters. */
export async function listAllVizBankTransactions(client: SupabaseClient): Promise<RawBankTxn[]> {
  const { data, error } = await client
    .schema("finance")
    .from("bank_transactions")
    .select("id, bank_account_id, amount_cents, posted_on, name, merchant_name, category")
    .order("posted_on", { ascending: true });
  if (error) throw new Error(`bank_transactions list failed: ${error.message}`);
  return (data ?? []) as RawBankTxn[];
}

export async function listVizPostings(client: SupabaseClient): Promise<RawPosting[]> {
  const { data, error } = await client
    .schema("finance")
    .from("postings")
    .select("id, entry_id, account_id, debit_cents, credit_cents");
  if (error) throw new Error(`postings list failed: ${error.message}`);
  return (data ?? []) as RawPosting[];
}

export async function listVizJournalEntries(client: SupabaseClient): Promise<RawJournalEntry[]> {
  const { data, error } = await client
    .schema("finance")
    .from("journal_entries")
    .select("id, entity_code, entry_date, ref_table, ref_id");
  if (error) throw new Error(`journal_entries list failed: ${error.message}`);
  return (data ?? []) as RawJournalEntry[];
}

export async function listVizLedgerAccounts(client: SupabaseClient): Promise<RawLedgerAccount[]> {
  const { data, error } = await client.schema("finance").from("accounts").select("id, entity_code, code, name, type");
  if (error) throw new Error(`accounts list failed: ${error.message}`);
  return (data ?? []) as RawLedgerAccount[];
}

export function indexBankTransactionsById(txns: RawBankTxn[]): Map<string, RawBankTxn> {
  return new Map(txns.map((t) => [t.id, t]));
}

// Pure aggregation functions for the viz endpoints (issue #19764). Kept free of any Supabase
// client so they're directly unit-testable (see viz-aggregate.test.ts) against fixture rows
// that mirror the real finance.* schema.

import { bucketRange, bucketStart, type Grain } from "./dates";
import { BUSINESS_ENTITY_CODES, type EntityCode } from "./entities";
import {
  isTransferLike,
  type RawBankAccount,
  type RawBankTxn,
  type RawJournalEntry,
  type RawLedgerAccount,
  type RawPosting,
} from "./viz-types";

export interface CashSeriesPoint {
  date: string;
  byAccount: Record<string, number>;
  total_cents: number;
}

export interface CashSeriesResult {
  accounts: RawBankAccount[];
  series: CashSeriesPoint[];
  asOf: string;
}

/** For one account: walks all its transactions forward from the earliest known balance to
 * build an end-of-day running balance, anchored exactly on current_balance_cents so the
 * series ends at the live SimpleFIN number (per issue: "derive backwards ... so history is
 * exact"). Returns a date-sorted list of [date, balanceAtEndOfThatDate]. */
function endOfDayBalances(txns: RawBankTxn[], currentBalanceCents: number): Array<[string, number]> {
  const sorted = [...txns].sort((a, b) => (a.posted_on < b.posted_on ? -1 : a.posted_on > b.posted_on ? 1 : a.id.localeCompare(b.id)));
  const sumAll = sorted.reduce((s, t) => s + t.amount_cents, 0);
  let running = currentBalanceCents - sumAll; // balance before the first transaction
  const byDate = new Map<string, number>();
  for (const t of sorted) {
    running += t.amount_cents;
    byDate.set(t.posted_on, running); // last txn on a given date wins -> end-of-day balance
  }
  return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Balance as of the end of `targetDate`, carrying forward the last known point (or the
 * pre-first-transaction balance if targetDate precedes all transactions). */
function balanceAsOf(points: Array<[string, number]>, before: number, targetDate: string): number {
  let result = before;
  for (const [date, bal] of points) {
    if (date > targetDate) break;
    result = bal;
  }
  return result;
}

export function computeCashSeries(
  accounts: RawBankAccount[],
  txnsByAccount: Map<string, RawBankTxn[]>,
  grain: Grain,
  from: string,
  to: string,
  asOf: string,
): CashSeriesResult {
  const perAccountPoints = new Map<string, { points: Array<[string, number]>; before: number }>();
  for (const acct of accounts) {
    const txns = txnsByAccount.get(acct.id) ?? [];
    const current = acct.current_balance_cents ?? 0;
    const points = endOfDayBalances(txns, current);
    const sumAll = txns.reduce((s, t) => s + t.amount_cents, 0);
    perAccountPoints.set(acct.id, { points, before: current - sumAll });
  }

  const buckets = bucketRange(from, to, grain);
  const series: CashSeriesPoint[] = buckets.map((bucketDate) => {
    // For non-day grains, value the bucket at its LAST day (end of week/month), so a
    // "September" point reflects the balance as of Sep-30, not Sep-01.
    const endOfBucket =
      grain === "day" ? bucketDate : nextBucketStart(bucketDate, grain, buckets) ?? to;
    const byAccount: Record<string, number> = {};
    let total = 0;
    for (const acct of accounts) {
      const p = perAccountPoints.get(acct.id)!;
      const bal = balanceAsOf(p.points, p.before, endOfBucket);
      byAccount[acct.id] = bal;
      total += bal;
    }
    return { date: bucketDate, byAccount, total_cents: total };
  });

  return { accounts, series, asOf };
}

function nextBucketStart(bucketDate: string, grain: Grain, buckets: string[]): string | null {
  const idx = buckets.indexOf(bucketDate);
  if (idx === -1 || idx === buckets.length - 1) return null;
  const d = new Date(`${buckets[idx + 1]}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface CashflowBucket {
  bucket: string;
  inflow_cents: number;
  outflow_cents: number;
  net_cents: number;
}

export function computeCashflow(txns: RawBankTxn[], grain: Grain, from: string, to: string): CashflowBucket[] {
  const buckets = new Map<string, { inflow: number; outflow: number }>();
  for (const b of bucketRange(from, to, grain)) buckets.set(b, { inflow: 0, outflow: 0 });

  for (const t of txns) {
    if (t.posted_on < from || t.posted_on > to) continue;
    if (isTransferLike(t.category)) continue;
    const bucket = bucketStart(t.posted_on, grain);
    const entry = buckets.get(bucket);
    if (!entry) continue;
    if (t.amount_cents > 0) entry.inflow += t.amount_cents;
    else entry.outflow += -t.amount_cents;
  }

  return [...buckets.entries()].map(([bucket, { inflow, outflow }]) => ({
    bucket,
    inflow_cents: inflow,
    outflow_cents: outflow,
    net_cents: inflow - outflow,
  }));
}

export interface BurnMonth {
  month: string;
  expense_cents: number;
}

export interface BurnResult {
  months: BurnMonth[];
  recurringMonthlyRunrateDollars: number;
  avg3MoBurnCents: number;
  cashOnHandCents: number;
  runwayMonths: number | null;
}

function expenseCentsByEntry(postings: RawPosting[], expenseAccountIds: Set<string>): Map<string, number> {
  const byEntry = new Map<string, number>();
  for (const p of postings) {
    if (!expenseAccountIds.has(p.account_id)) continue;
    const net = p.debit_cents - p.credit_cents; // EXPENSE accounts: debit increases, credit (refund) decreases
    byEntry.set(p.entry_id, (byEntry.get(p.entry_id) ?? 0) + net);
  }
  return byEntry;
}

export function computeBurn(
  postings: RawPosting[],
  journalEntries: RawJournalEntry[],
  ledgerAccounts: RawLedgerAccount[],
  entityScope: EntityCode[],
  cashOnHandCents: number,
  recurringMonthlyRunrateDollars: number,
): BurnResult {
  const expenseAccountIds = new Set(ledgerAccounts.filter((a) => a.type === "EXPENSE").map((a) => a.id));
  const entryById = new Map(journalEntries.map((e) => [e.id, e]));
  const entryExpense = expenseCentsByEntry(postings, expenseAccountIds);

  const monthly = new Map<string, number>();
  for (const [entryId, cents] of entryExpense) {
    const entry = entryById.get(entryId);
    if (!entry || !entityScope.includes(entry.entity_code)) continue;
    const month = bucketStart(entry.entry_date, "month");
    monthly.set(month, (monthly.get(month) ?? 0) + cents);
  }

  const months = [...monthly.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(
    ([month, expense_cents]) => ({ month, expense_cents }),
  );

  const trailing3 = months.slice(-3);
  const avg3MoBurnCents = trailing3.length
    ? Math.round(trailing3.reduce((s, m) => s + m.expense_cents, 0) / trailing3.length)
    : 0;

  const runwayMonths = avg3MoBurnCents > 0 ? cashOnHandCents / avg3MoBurnCents : null;

  return {
    months,
    recurringMonthlyRunrateDollars,
    avg3MoBurnCents,
    cashOnHandCents,
    runwayMonths,
  };
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

export function computeCategories(
  postings: RawPosting[],
  journalEntries: RawJournalEntry[],
  ledgerAccounts: RawLedgerAccount[],
  bankTxnsById: Map<string, RawBankTxn>,
  entityScope: EntityCode[],
  from: string,
  to: string,
): { categories: CategoryBreakdown[]; topVendors: VendorBreakdown[] } {
  const expenseAccounts = new Map(
    ledgerAccounts.filter((a) => a.type === "EXPENSE").map((a) => [a.id, a]),
  );
  const entryById = new Map(journalEntries.map((e) => [e.id, e]));

  const byCategory = new Map<string, CategoryBreakdown>();
  const byVendor = new Map<string, VendorBreakdown>();

  for (const p of postings) {
    const ledgerAccount = expenseAccounts.get(p.account_id);
    if (!ledgerAccount) continue;
    const entry = entryById.get(p.entry_id);
    if (!entry || !entityScope.includes(entry.entity_code)) continue;
    if (entry.entry_date < from || entry.entry_date > to) continue;

    const net = p.debit_cents - p.credit_cents;
    const key = ledgerAccount.code;
    const existing = byCategory.get(key);
    if (existing) existing.amount_cents += net;
    else byCategory.set(key, { account_code: ledgerAccount.code, account_name: ledgerAccount.name, amount_cents: net });

    if (entry.ref_table?.startsWith("finance.bank_transactions") && entry.ref_id) {
      const txn = bankTxnsById.get(entry.ref_id);
      const vendor = txn?.merchant_name || txn?.name || "Unknown vendor";
      const v = byVendor.get(vendor);
      if (v) {
        v.amount_cents += net;
        v.occurrences += 1;
      } else {
        byVendor.set(vendor, { vendor, amount_cents: net, occurrences: 1 });
      }
    }
  }

  const categories = [...byCategory.values()].sort((a, b) => b.amount_cents - a.amount_cents);
  const topVendors = [...byVendor.values()].sort((a, b) => b.amount_cents - a.amount_cents).slice(0, 10);

  return { categories, topVendors };
}

export function totalCashOnHandCents(accounts: RawBankAccount[], scope: EntityCode[]): number {
  return accounts.filter((a) => scope.includes(a.entity_code)).reduce((s, a) => s + (a.current_balance_cents ?? 0), 0);
}

export function assertExcludesPersonal(scope: EntityCode[]): void {
  if (scope.includes("ariel_personal") && scope.length === BUSINESS_ENTITY_CODES.length) {
    throw new Error("invariant violated: business scope must never include ariel_personal");
  }
}

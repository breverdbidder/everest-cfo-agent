import { describe, expect, it } from "vitest";
import {
  computeBurn,
  computeCashflow,
  computeCashSeries,
  computeCategories,
  totalCashOnHandCents,
} from "./viz-aggregate";
import type { RawBankAccount, RawBankTxn, RawJournalEntry, RawLedgerAccount, RawPosting } from "./viz-types";

const acct = (over: Partial<RawBankAccount>): RawBankAccount => ({
  id: "acct-1",
  name: "Test Account",
  mask: null,
  entity_code: "everest_capital_brevard",
  current_balance_cents: 0,
  data_source: "REAL",
  ...over,
});

const txn = (over: Partial<RawBankTxn>): RawBankTxn => ({
  id: "t1",
  bank_account_id: "acct-1",
  amount_cents: 0,
  posted_on: "2026-01-01",
  name: "txn",
  merchant_name: null,
  category: null,
  ...over,
});

describe("computeCashSeries", () => {
  it("ends exactly at current_balance_cents and derives history backwards", () => {
    const accounts = [acct({ id: "a1", current_balance_cents: 11347 })];
    const txns = new Map([
      [
        "a1",
        [
          txn({ id: "t1", bank_account_id: "a1", posted_on: "2026-01-05", amount_cents: 5000 }),
          txn({ id: "t2", bank_account_id: "a1", posted_on: "2026-01-10", amount_cents: -2000 }),
          txn({ id: "t3", bank_account_id: "a1", posted_on: "2026-01-15", amount_cents: 8347 }),
        ],
      ],
    ]);
    const result = computeCashSeries(accounts, txns, "day", "2026-01-01", "2026-01-20", "2026-01-20T00:00:00Z");
    const last = result.series[result.series.length - 1];
    expect(last.total_cents).toBe(11347);

    // Before any transaction: balance = current - sum(all txns) = 11347 - 11347 = 0
    const first = result.series[0];
    expect(first.byAccount["a1"]).toBe(0);

    // Between t1 and t2 (Jan 6-9): balance should reflect only t1 applied
    const jan7 = result.series.find((p) => p.date === "2026-01-07")!;
    expect(jan7.byAccount["a1"]).toBe(5000);
  });

  it("sums multiple accounts into total_cents", () => {
    const accounts = [acct({ id: "a1", current_balance_cents: 100 }), acct({ id: "a2", current_balance_cents: 200 })];
    const result = computeCashSeries(accounts, new Map(), "day", "2026-01-01", "2026-01-01", "now");
    expect(result.series[0].total_cents).toBe(300);
  });
});

describe("computeCashflow", () => {
  it("splits inflow and outflow and computes net", () => {
    const txns = [
      txn({ posted_on: "2026-01-05", amount_cents: 10000 }),
      txn({ posted_on: "2026-01-06", amount_cents: -3000 }),
    ];
    const [bucket] = computeCashflow(txns, "month", "2026-01-01", "2026-01-31");
    expect(bucket.inflow_cents).toBe(10000);
    expect(bucket.outflow_cents).toBe(3000);
    expect(bucket.net_cents).toBe(7000);
  });

  it("excludes Transfer and Payment category transactions", () => {
    const txns = [
      txn({ posted_on: "2026-01-05", amount_cents: 5000, category: ["Transfer", "Deposit"] }),
      txn({ posted_on: "2026-01-06", amount_cents: -5000, category: ["Payment", "Credit Card"] }),
      txn({ posted_on: "2026-01-07", amount_cents: 100, category: ["Food and Drink"] }),
    ];
    const [bucket] = computeCashflow(txns, "month", "2026-01-01", "2026-01-31");
    expect(bucket.inflow_cents).toBe(100);
    expect(bucket.outflow_cents).toBe(0);
  });

  it("drops transactions outside the requested range", () => {
    const txns = [txn({ posted_on: "2025-12-31", amount_cents: 999 })];
    const [bucket] = computeCashflow(txns, "month", "2026-01-01", "2026-01-31");
    expect(bucket.inflow_cents).toBe(0);
  });
});

describe("totalCashOnHandCents", () => {
  it("excludes accounts outside scope", () => {
    const accounts = [
      acct({ id: "a1", entity_code: "everest_capital_brevard", current_balance_cents: 100 }),
      acct({ id: "a2", entity_code: "ariel_personal", current_balance_cents: 999 }),
    ];
    expect(totalCashOnHandCents(accounts, ["everest_capital_brevard"])).toBe(100);
  });

  it("treats null current_balance_cents (FIXTURE accounts) as zero", () => {
    const accounts = [acct({ id: "a1", current_balance_cents: null })];
    expect(totalCashOnHandCents(accounts, ["everest_capital_brevard"])).toBe(0);
  });
});

const ledgerAccount = (over: Partial<RawLedgerAccount>): RawLedgerAccount => ({
  id: "la1",
  entity_code: "everest_capital_brevard",
  code: "5000",
  name: "Operating Expenses",
  type: "EXPENSE",
  ...over,
});

const journalEntry = (over: Partial<RawJournalEntry>): RawJournalEntry => ({
  id: "je1",
  entity_code: "everest_capital_brevard",
  entry_date: "2026-01-15",
  ref_table: null,
  ref_id: null,
  ...over,
});

const posting = (over: Partial<RawPosting>): RawPosting => ({
  id: "p1",
  entry_id: "je1",
  account_id: "la1",
  debit_cents: 0,
  credit_cents: 0,
  ...over,
});

describe("computeBurn", () => {
  it("sums EXPENSE debits net of credits per month, scoped by entity", () => {
    const ledgerAccounts = [
      ledgerAccount({ id: "exp1", type: "EXPENSE" }),
      ledgerAccount({ id: "asset1", type: "ASSET" }),
    ];
    const journalEntries = [
      journalEntry({ id: "je1", entity_code: "everest_capital_brevard", entry_date: "2026-01-15" }),
      journalEntry({ id: "je2", entity_code: "ariel_personal", entry_date: "2026-01-20" }),
    ];
    const postings = [
      posting({ entry_id: "je1", account_id: "exp1", debit_cents: 5000 }),
      posting({ entry_id: "je1", account_id: "asset1", debit_cents: 5000 }), // not EXPENSE, ignored
      posting({ entry_id: "je2", account_id: "exp1", debit_cents: 9999 }), // out of scope
    ];
    const result = computeBurn(postings, journalEntries, ledgerAccounts, ["everest_capital_brevard"], 100000, 200);
    expect(result.months).toEqual([{ month: "2026-01-01", expense_cents: 5000 }]);
    expect(result.avg3MoBurnCents).toBe(5000);
    expect(result.runwayMonths).toBeCloseTo(100000 / 5000);
  });

  it("nets credits (refunds) against debits", () => {
    const ledgerAccounts = [ledgerAccount({ id: "exp1" })];
    const journalEntries = [journalEntry({ id: "je1" })];
    const postings = [
      posting({ entry_id: "je1", account_id: "exp1", debit_cents: 1000, credit_cents: 200 }),
    ];
    const result = computeBurn(postings, journalEntries, ledgerAccounts, ["everest_capital_brevard"], 0, 0);
    expect(result.months[0].expense_cents).toBe(800);
  });

  it("returns null runway when there is no recent burn", () => {
    const result = computeBurn([], [], [], ["everest_capital_brevard"], 5000, 0);
    expect(result.runwayMonths).toBeNull();
  });
});

describe("computeCategories", () => {
  it("groups by account code and finds top vendors from linked bank transactions", () => {
    const ledgerAccounts = [ledgerAccount({ id: "exp1", code: "5100", name: "SaaS" })];
    const journalEntries = [
      journalEntry({ id: "je1", entry_date: "2026-02-01", ref_table: "finance.bank_transactions", ref_id: "bt1" }),
      journalEntry({ id: "je2", entry_date: "2026-02-02", ref_table: "finance.bank_transactions", ref_id: "bt2" }),
    ];
    const postings = [
      posting({ id: "p1", entry_id: "je1", account_id: "exp1", debit_cents: 3000 }),
      posting({ id: "p2", entry_id: "je2", account_id: "exp1", debit_cents: 7000 }),
    ];
    const bankTxnsById = new Map([
      ["bt1", txn({ id: "bt1", merchant_name: "Vendor A" })],
      ["bt2", txn({ id: "bt2", merchant_name: "Vendor A" })],
    ]);
    const { categories, topVendors } = computeCategories(
      postings,
      journalEntries,
      ledgerAccounts,
      bankTxnsById,
      ["everest_capital_brevard"],
      "2026-01-01",
      "2026-12-31",
    );
    expect(categories).toEqual([{ account_code: "5100", account_name: "SaaS", amount_cents: 10000 }]);
    expect(topVendors[0]).toEqual({ vendor: "Vendor A", amount_cents: 10000, occurrences: 2 });
  });

  it("excludes entries outside the date range", () => {
    const ledgerAccounts = [ledgerAccount({ id: "exp1" })];
    const journalEntries = [journalEntry({ id: "je1", entry_date: "2025-01-01" })];
    const postings = [posting({ entry_id: "je1", account_id: "exp1", debit_cents: 500 })];
    const { categories } = computeCategories(postings, journalEntries, ledgerAccounts, new Map(), ["everest_capital_brevard"], "2026-01-01", "2026-12-31");
    expect(categories).toEqual([]);
  });
});

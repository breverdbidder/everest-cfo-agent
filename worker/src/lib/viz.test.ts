// Regression test for issue #19769 bug 3: FIXTURE-tagged bank accounts leaking into
// "All business" viz aggregates. listVizBankAccounts is the single source every /api/viz/*
// endpoint reads accounts from (agent.ts getVizData), so this is the one place that matters.
import { describe, expect, it } from "vitest";
import { listVizBankAccounts } from "./viz";

/** Minimal fake mirroring the exact chain viz.ts calls: client.schema(s).from(t).select(c)
 * (awaited directly) and .select(c).in(col, ids) (awaited after .in()). Real
 * @supabase/supabase-js query builders are thenable objects; this reproduces just that shape
 * against fixture rows keyed by table name. */
function fakeClient(rowsByTable: Record<string, unknown[]>) {
  return {
    schema(_schema: string) {
      return {
        from(table: string) {
          const rows = rowsByTable[table] ?? [];
          const result = { data: rows, error: null };
          return {
            select(_cols: string) {
              return {
                then: (resolve: (v: typeof result) => void) => resolve(result),
                in(_col: string, _ids: string[]) {
                  return Promise.resolve(result);
                },
              };
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("listVizBankAccounts", () => {
  it("excludes FIXTURE-tagged accounts (null current_balance_cents) from every viz aggregate", async () => {
    const client = fakeClient({
      bank_accounts: [
        { id: "real-1", name: "BUSINESS CHECKING ...3519", mask: "3519", current_balance_cents: 11347, ledger_account_id: "la-1" },
        { id: "fixture-1", name: "Business Checking (FIXTURE)", mask: "0000", current_balance_cents: null, ledger_account_id: "la-2" },
      ],
      accounts: [
        { id: "la-1", entity_code: "everest_capital_brevard" },
        { id: "la-2", entity_code: "biddeed" },
      ],
    });

    const accounts = await listVizBankAccounts(client);

    expect(accounts.map((a) => a.id)).toEqual(["real-1"]);
    expect(accounts.every((a) => a.data_source === "REAL")).toBe(true);
  });

  it("keeps REAL accounts across every entity, not just one", async () => {
    const client = fakeClient({
      bank_accounts: [
        { id: "real-1", name: "A", mask: "1111", current_balance_cents: 100, ledger_account_id: "la-1" },
        { id: "real-2", name: "B", mask: "2222", current_balance_cents: -500, ledger_account_id: "la-2" },
      ],
      accounts: [
        { id: "la-1", entity_code: "everest_capital_brevard" },
        { id: "la-2", entity_code: "ariel_personal" },
      ],
    });

    const accounts = await listVizBankAccounts(client);

    expect(accounts).toHaveLength(2);
    expect(accounts.every((a) => a.data_source === "REAL")).toBe(true);
  });
});

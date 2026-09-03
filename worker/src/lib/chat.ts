// CFO chat (issue #19764). Grounded ONLY in a fixed catalog of read-only views/aggregates --
// never lets the model author raw SQL text that gets executed. DeepSeek classifies the
// question into one catalog intent + a small set of allowlisted filters (JSON mode); this
// file then runs the matching, already-scoped-to-cfo_agent_ro query deterministically and
// renders the equivalent SELECT for the UI's "view SQL" toggle. This keeps the chat feature
// exactly as read-only as every other endpoint on this Worker without adding a finance.*
// schema object (issue #19762 owns finance.* changes -- out of scope here) or a generic
// SQL-execution RPC.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ENTITY_LABELS, isEntityCode, type EntityCode } from "./entities";
import { resolveRange } from "./dates";
import { indexBankTransactionsById } from "./viz";
import { computeBurn, computeCashflow, computeCategories, totalCashOnHandCents } from "./viz-aggregate";
import type { VizDataBundle } from "./viz-types";
import { listCommingledCosts, listReconExceptions, listReconSummary, listRecurringCosts } from "./supabase";

const CATALOG_INTENTS = [
  "burn",
  "cashflow",
  "cash_on_hand",
  "categories",
  "recurring_costs",
  "commingled_costs",
  "recon_summary",
  "recon_exceptions",
] as const;
type CatalogIntent = (typeof CATALOG_INTENTS)[number];

interface ChatFilters {
  intent: CatalogIntent | null;
  entity: EntityCode | "all" | null;
  from: string | null;
  to: string | null;
}

export interface ChatAnswer {
  answer: string;
  numbers: Record<string, unknown>;
  sql: string;
  refused: boolean;
  entity: string;
}

const CATALOG_DESCRIPTION = `You classify a CFO's question about their business finances into exactly one of these
read-only catalog intents. Respond with ONLY a JSON object, no prose, matching this shape:
{"intent": "<one of the intents below, or null if none fit>", "entity": "<one of the entity codes below, or \\"all\\", or null>", "from": "<YYYY-MM-DD or null>", "to": "<YYYY-MM-DD or null>"}

Intents:
- burn: monthly burn/spend trend, runway
- cashflow: inflow/outflow/net cash movement over time
- cash_on_hand: current bank balances
- categories: spend broken down by expense category or vendor
- recurring_costs: subscriptions / recurring vendor charges
- commingled_costs: business costs paid from Ariel's personal account
- recon_summary: bank reconciliation match rate
- recon_exceptions: unmatched / exception bank transactions

Entity codes: everest_capital_brevard, everest_capital, biddeed, zonewise, winnerdata, protection_partners, ariel_personal, or "all" (every entity except ariel_personal).

If the question is not about one of these 8 topics, set intent to null.`;

export function parseFiltersResponse(raw: string): ChatFilters {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { intent: null, entity: null, from: null, to: null };
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const intentRaw = typeof obj.intent === "string" ? obj.intent : null;
  const intent = (CATALOG_INTENTS as readonly string[]).includes(intentRaw ?? "") ? (intentRaw as CatalogIntent) : null;
  const entityRaw = typeof obj.entity === "string" ? obj.entity : null;
  const entity: EntityCode | "all" | null = entityRaw === "all" ? "all" : isEntityCode(entityRaw) ? entityRaw : null;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const from = typeof obj.from === "string" && dateRe.test(obj.from) ? obj.from : null;
  const to = typeof obj.to === "string" && dateRe.test(obj.to) ? obj.to : null;
  return { intent, entity, from, to };
}

async function classify(question: string, deepseekApiKey: string | undefined): Promise<ChatFilters> {
  if (!deepseekApiKey) return { intent: null, entity: null, from: null, to: null };
  try {
    const resp = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepseekApiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CATALOG_DESCRIPTION },
          { role: "user", content: question },
        ],
      }),
    });
    if (!resp.ok) return { intent: null, entity: null, from: null, to: null };
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content;
    return text ? parseFiltersResponse(text) : { intent: null, entity: null, from: null, to: null };
  } catch {
    return { intent: null, entity: null, from: null, to: null };
  }
}

function scopeFor(entity: EntityCode | "all" | null): EntityCode[] {
  const ALL: EntityCode[] = ["everest_capital_brevard", "everest_capital", "biddeed", "zonewise", "winnerdata", "protection_partners"];
  if (entity && entity !== "all") return [entity];
  return ALL;
}

const REFUSAL =
  "I can only answer questions about burn/runway, cashflow, cash on hand, spend categories, " +
  "recurring costs, commingled costs, or bank reconciliation -- grounded in the same read-only " +
  "views the dashboard uses. Try rephrasing around one of those topics.";

export async function answerCfoChatQuestion(
  client: SupabaseClient,
  question: string,
  deepseekApiKey: string | undefined,
  viz: VizDataBundle,
): Promise<ChatAnswer> {
  const filters = await classify(question, deepseekApiKey);
  const entity = filters.entity ?? "unspecified";
  if (!filters.intent) {
    return { answer: REFUSAL, numbers: {}, sql: "-- no query executed (question outside catalog)", refused: true, entity };
  }
  const result = await runIntent(client, filters, viz);
  return { ...result, entity };
}

async function runIntent(
  client: SupabaseClient,
  filters: ChatFilters,
  viz: VizDataBundle,
): Promise<Omit<ChatAnswer, "entity">> {
  const scope = scopeFor(filters.entity);
  const entityLabel = filters.entity && filters.entity !== "all" ? ENTITY_LABELS[filters.entity] : "All business";
  const entityWhere = filters.entity && filters.entity !== "all" ? `entity_code = '${filters.entity}'` : `entity_code IN (${scope.map((e) => `'${e}'`).join(", ")})`;

  switch (filters.intent) {
    case "burn": {
      const cashOnHandCents = totalCashOnHandCents(viz.accounts, scope);
      const recurring = await listRecurringCosts(client);
      const recurringRunrateDollars = recurring
        .filter((r) => scope.includes(r.entity_code as EntityCode))
        .reduce((s, r) => s + (r.monthly_runrate_dollars ?? 0), 0);
      const burn = computeBurn(viz.postings, viz.journalEntries, viz.ledgerAccounts, scope, cashOnHandCents, recurringRunrateDollars);
      const last = burn.months[burn.months.length - 1];
      const answer = last
        ? `${entityLabel} burned $${(last.expense_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} in ${last.month.slice(0, 7)}. ` +
          `3-month average burn is $${(burn.avg3MoBurnCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}/mo, ` +
          `cash on hand is $${(burn.cashOnHandCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}` +
          (burn.runwayMonths !== null ? `, giving ~${burn.runwayMonths.toFixed(1)} months of runway.` : ", with no recent burn to project runway from.")
        : `No EXPENSE postings found for ${entityLabel}.`;
      return {
        answer,
        numbers: { months: burn.months, avg3MoBurnCents: burn.avg3MoBurnCents, cashOnHandCents: burn.cashOnHandCents, runwayMonths: burn.runwayMonths },
        sql: `SELECT date_trunc('month', je.entry_date) AS month, SUM(p.debit_cents - p.credit_cents) AS expense_cents\nFROM finance.postings p\nJOIN finance.journal_entries je ON je.id = p.entry_id\nJOIN finance.accounts a ON a.id = p.account_id AND a.type = 'EXPENSE'\nWHERE je.${entityWhere}\nGROUP BY 1 ORDER BY 1;`,
        refused: false,
      };
    }
    case "cashflow": {
      const scopedAccountIds = new Set(viz.accounts.filter((a) => scope.includes(a.entity_code)).map((a) => a.id));
      const scopedTxns = viz.bankTxns.filter((t) => scopedAccountIds.has(t.bank_account_id));
      const earliest = scopedTxns.reduce((min, t) => (t.posted_on < min ? t.posted_on : min), "9999-12-31");
      const { from, to } = resolveRange(filters.from, filters.to, "90d", earliest === "9999-12-31" ? "2026-01-01" : earliest);
      const buckets = computeCashflow(scopedTxns, "month", from, to);
      const totalInflow = buckets.reduce((s, b) => s + b.inflow_cents, 0);
      const totalOutflow = buckets.reduce((s, b) => s + b.outflow_cents, 0);
      return {
        answer: `${entityLabel} cashflow from ${from} to ${to}: inflow $${(totalInflow / 100).toLocaleString()}, outflow $${(totalOutflow / 100).toLocaleString()}, net $${((totalInflow - totalOutflow) / 100).toLocaleString()}.`,
        numbers: { from, to, buckets },
        sql: `SELECT date_trunc('month', posted_on) AS bucket, SUM(amount_cents) FILTER (WHERE amount_cents > 0) AS inflow_cents, SUM(-amount_cents) FILTER (WHERE amount_cents < 0) AS outflow_cents\nFROM finance.bank_transactions bt JOIN finance.bank_accounts ba ON ba.id = bt.bank_account_id JOIN finance.accounts a ON a.id = ba.ledger_account_id\nWHERE a.${entityWhere} AND bt.posted_on BETWEEN '${from}' AND '${to}' AND (bt.category IS NULL OR bt.category[1] NOT IN ('Transfer','Payment'))\nGROUP BY 1 ORDER BY 1;`,
        refused: false,
      };
    }
    case "cash_on_hand": {
      const cents = totalCashOnHandCents(viz.accounts, scope);
      const byAccount = viz.accounts.filter((a) => scope.includes(a.entity_code)).map((a) => ({ name: a.name, balance_cents: a.current_balance_cents ?? 0 }));
      return {
        answer: `${entityLabel} cash on hand is $${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} across ${byAccount.length} account(s).`,
        numbers: { cashOnHandCents: cents, byAccount },
        sql: `SELECT ba.name, ba.current_balance_cents FROM finance.bank_accounts ba JOIN finance.accounts a ON a.id = ba.ledger_account_id WHERE a.${entityWhere};`,
        refused: false,
      };
    }
    case "categories": {
      const earliest = viz.journalEntries.reduce((min, e) => (e.entry_date < min ? e.entry_date : min), "9999-12-31");
      const { from, to } = resolveRange(filters.from, filters.to, "90d", earliest === "9999-12-31" ? "2026-01-01" : earliest);
      const bankTxnsById = indexBankTransactionsById(viz.bankTxns);
      const { categories, topVendors } = computeCategories(viz.postings, viz.journalEntries, viz.ledgerAccounts, bankTxnsById, scope, from, to);
      const top = categories[0];
      return {
        answer: top
          ? `${entityLabel} top spend category from ${from} to ${to} is ${top.account_name} at $${(top.amount_cents / 100).toLocaleString()}. Top vendor: ${topVendors[0]?.vendor ?? "n/a"}.`
          : `No expense postings found for ${entityLabel} from ${from} to ${to}.`,
        numbers: { from, to, categories, topVendors },
        sql: `SELECT a.code, a.name, SUM(p.debit_cents - p.credit_cents) AS amount_cents\nFROM finance.postings p JOIN finance.journal_entries je ON je.id = p.entry_id JOIN finance.accounts a ON a.id = p.account_id AND a.type = 'EXPENSE'\nWHERE je.${entityWhere} AND je.entry_date BETWEEN '${from}' AND '${to}'\nGROUP BY 1, 2 ORDER BY 3 DESC;`,
        refused: false,
      };
    }
    case "recurring_costs": {
      const rows = (await listRecurringCosts(client)).filter((r) => scope.includes(r.entity_code as EntityCode));
      const total = rows.reduce((s, r) => s + (r.monthly_runrate_dollars ?? 0), 0);
      return {
        answer: `${entityLabel} has ${rows.length} recurring cost(s) totalling $${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}/mo run-rate.`,
        numbers: { rows, totalMonthlyRunrateDollars: total },
        sql: `SELECT * FROM finance.v_recurring_costs WHERE ${entityWhere} ORDER BY monthly_runrate_dollars DESC NULLS LAST;`,
        refused: false,
      };
    }
    case "commingled_costs": {
      const rows = await listCommingledCosts(client);
      const filtered = filters.entity && filters.entity !== "all" ? rows.filter((r) => r.likely_business_entity === filters.entity) : rows;
      const total = filtered.reduce((s, r) => s + r.amount_dollars, 0);
      return {
        answer: `${filtered.length} commingled cost(s) paid from Ariel's personal account, totalling $${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}${filters.entity && filters.entity !== "all" ? ` likely belonging to ${entityLabel}` : ""}.`,
        numbers: { rows: filtered, totalDollars: total },
        sql: `SELECT * FROM finance.v_commingled_business_costs${filters.entity && filters.entity !== "all" ? ` WHERE likely_business_entity = '${filters.entity}'` : ""} ORDER BY txn_date DESC;`,
        refused: false,
      };
    }
    case "recon_summary": {
      const rows = (await listReconSummary(client)).filter((r) => scope.includes(r.entity_code as EntityCode));
      return {
        answer: rows.length
          ? `${entityLabel} reconciliation: ${rows.map((r) => `${r.period} ${r.matched}/${r.bank_rows} matched (${r.matched_pct ?? 0}%)`).join("; ")}.`
          : `No reconciliation summary rows for ${entityLabel}.`,
        numbers: { rows },
        sql: `SELECT * FROM finance.v_recon_summary WHERE ${entityWhere} ORDER BY period;`,
        refused: false,
      };
    }
    case "recon_exceptions": {
      const rows = (await listReconExceptions(client)).filter((r) => r.entity_code === null || scope.includes(r.entity_code as EntityCode));
      const open = rows.filter((r) => r.status === "open");
      return {
        answer: `${entityLabel} has ${open.length} open reconciliation exception(s) out of ${rows.length} total.`,
        numbers: { rows: rows.slice(0, 500) },
        sql: `SELECT * FROM finance.v_recon_exceptions WHERE ${entityWhere} ORDER BY opened_at DESC LIMIT 500;`,
        refused: false,
      };
    }
    default:
      return { answer: REFUSAL, numbers: {}, sql: "-- no query executed (question outside catalog)", refused: true };
  }
}

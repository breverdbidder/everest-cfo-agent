// CfoAgent — the Cloudflare Agents SDK agent class for this rewrite (issue #19646).
// One TypeScript class on a Durable Object, replacing the Python LangGraph graph
// (graph/cfo_graph.py) that orchestrated the KPI/fraud/health-score/forecast agents.
// Single-tenant: one instance, named "ariel-cfo", holds a short-lived cache of the
// last computed analysis (mirrors health_score.py's 120s in-memory TTL cache, but
// backed by Durable Object storage so it survives isolate eviction).

import { Agent } from "agents";
import type { Env } from "./lib/env";
import {
  getSupabaseClient,
  listBillableFFComparison,
  listBillableFFEvents,
  listCfoDailyClose,
  listCheckpoints,
  listCommingledCosts,
  listExpenseLedger,
  listReconExceptions,
  listReconSummary,
  listRecurringCosts,
  listRevenueLedger,
  listWallets,
  loadRawFinancialRows,
  getTaxPackage as fetchTaxPackage,
} from "./lib/supabase";
import { computeKpiSnapshots, detectStatisticalAnomalies } from "./lib/kpi-engine";
import { computeCustomerProfiles, detectFraudPatterns } from "./lib/fraud";
import { computeScenarioStressTest, computeSurvivalAnalysis } from "./lib/survival";
import { calculateHealthScore } from "./lib/health-score";
import { runCashFlowForecast } from "./lib/cash-flow-forecaster";
import type { KPISnapshot } from "./lib/types";
import { resolveEntityScope, type EntityCode } from "./lib/entities";
import { parseGrain, resolveRange, type Grain } from "./lib/dates";
import {
  indexBankTransactionsById,
  listAllVizBankTransactions,
  listVizBankAccounts,
  listVizJournalEntries,
  listVizLedgerAccounts,
  listVizPostings,
} from "./lib/viz";
import { computeBurn, computeCashflow, computeCashSeries, computeCategories, totalCashOnHandCents } from "./lib/viz-aggregate";
import type { VizDataBundle } from "./lib/viz-types";
import { answerCfoChatQuestion, type ChatAnswer } from "./lib/chat";
import { logChatQuery } from "./lib/ops-log";
import {
  checkAnomalies,
  getInvoice,
  ingestInvoice,
  listInvoices,
  saveDisputeDraft,
  setInvoiceStatus,
  writeLineVerification,
  type ExtractedInvoice,
} from "./lib/vendorInvoices";
import { verifyInvoiceLines } from "./lib/vendorAdapters";
import { draftDispute, type DisputeLineContext } from "./lib/invoiceDispute";

const ANALYSIS_CACHE_TTL_MS = 120_000; // mirrors health_score.py's _CACHE_TTL = 120s

interface AnalysisBundle {
  computedAt: string;
  snapshots: KPISnapshot[];
  anomalies: ReturnType<typeof detectStatisticalAnomalies>;
  fraudAlerts: ReturnType<typeof detectFraudPatterns>;
  customerProfiles: ReturnType<typeof computeCustomerProfiles>;
}

export class CfoAgent extends Agent<Env> {
  private async getAnalysis(forceRefresh = false): Promise<AnalysisBundle> {
    if (!forceRefresh) {
      const cached = await this.ctx.storage.get<AnalysisBundle>("analysis_cache");
      if (cached && Date.now() - Date.parse(cached.computedAt) < ANALYSIS_CACHE_TTL_MS) {
        return cached;
      }
    }

    const client = getSupabaseClient(this.env);
    const rawRows = await loadRawFinancialRows(client);

    const snapshots = computeKpiSnapshots(rawRows);
    const anomalies = detectStatisticalAnomalies(snapshots);
    const fraudAlerts = detectFraudPatterns(rawRows);
    const customerProfiles = computeCustomerProfiles(rawRows);

    const bundle: AnalysisBundle = {
      computedAt: new Date().toISOString(),
      snapshots,
      anomalies,
      fraudAlerts,
      customerProfiles,
    };
    await this.ctx.storage.put("analysis_cache", bundle);
    return bundle;
  }

  async getKpis(forceRefresh = false) {
    const { snapshots, computedAt } = await this.getAnalysis(forceRefresh);
    const latest = snapshots[snapshots.length - 1] ?? null;
    return { latest, history: snapshots, computedAt, weekCount: snapshots.length };
  }

  async getAnomalies(forceRefresh = false) {
    const { anomalies, computedAt } = await this.getAnalysis(forceRefresh);
    return { anomalies, computedAt };
  }

  async getFraudAlerts(forceRefresh = false) {
    const { fraudAlerts, computedAt } = await this.getAnalysis(forceRefresh);
    return { fraudAlerts, computedAt };
  }

  async getCustomers(forceRefresh = false) {
    const { customerProfiles, computedAt } = await this.getAnalysis(forceRefresh);
    return { customerProfiles, computedAt };
  }

  async getRunway(forceRefresh = false) {
    const { snapshots, computedAt } = await this.getAnalysis(forceRefresh);
    const survival = computeSurvivalAnalysis(snapshots);
    const scenarios = computeScenarioStressTest(snapshots);
    return { survival, scenarios, computedAt, weekCount: snapshots.length };
  }

  async getHealthScore(forceRefresh = false) {
    const { snapshots, anomalies, fraudAlerts, computedAt } = await this.getAnalysis(forceRefresh);
    const health = await calculateHealthScore(snapshots, anomalies, fraudAlerts, this.env.DEEPSEEK_API_KEY);
    return { health, computedAt };
  }

  async getCashFlowForecast() {
    const { snapshots } = await this.getAnalysis();
    const trailing8 = snapshots.slice(-8);
    const forecast = runCashFlowForecast(trailing8, []);
    return forecast;
  }

  async getCheckpoints() {
    const client = getSupabaseClient(this.env);
    return { checkpoints: await listCheckpoints(client) };
  }

  async getLedgers() {
    const client = getSupabaseClient(this.env);
    const [revenue, expenses] = await Promise.all([listRevenueLedger(client), listExpenseLedger(client)]);
    // REAL vs PROJECTED distinction (issue #19646 item 7): revenue_ledger/expense_ledger
    // rows are always REAL (booked, sourced from ff_billing/manual entry); the winnerdata
    // FF pricing-model comparison surfaced separately via getBillableFF() is PROJECTED.
    return {
      revenue: revenue.map((r) => ({ ...r, dataClass: "REAL" as const })),
      expenses: expenses.map((e) => ({ ...e, dataClass: "REAL" as const })),
    };
  }

  async getBillableFF() {
    const client = getSupabaseClient(this.env);
    const [events, comparison, wallets] = await Promise.all([
      listBillableFFEvents(client),
      listBillableFFComparison(client),
      listWallets(client),
    ]);
    return {
      events: events.map((e) => ({ ...e, dataClass: "REAL" as const })),
      comparison: comparison.map((c) => ({ ...c, dataClass: "PROJECTED" as const })),
      wallets,
    };
  }

  /** Issue #19738 CP6/CP7 -- bank reconciliation summary (finance.v_recon_summary). */
  async getReconSummary() {
    const client = getSupabaseClient(this.env);
    return { summary: await listReconSummary(client) };
  }

  /** Issue #19738 CP6/CP7 -- bank reconciliation exceptions (finance.v_recon_exceptions). */
  async getReconExceptions() {
    const client = getSupabaseClient(this.env);
    return { exceptions: await listReconExceptions(client) };
  }

  /** Issue #19755 CFO v1 Issue G -- recurring cost register (finance.v_recurring_costs). */
  async getRecurringCosts() {
    const client = getSupabaseClient(this.env);
    return { costs: await listRecurringCosts(client) };
  }

  /** Issue #19755 CFO v1 Issue G -- business infra/SaaS paid from ariel_personal
   * (finance.v_commingled_business_costs). Tier 1 propose-only. */
  async getCommingledCosts() {
    const client = getSupabaseClient(this.env);
    return { costs: await listCommingledCosts(client) };
  }

  /** Issue #19765 CFO v1 Issue J -- most recent automated daily close run, for a "books
   * current as of <timestamp>" badge (red if failed or the run is stale). */
  async getCloseLatest() {
    const client = getSupabaseClient(this.env);
    const [latest] = await listCfoDailyClose(client, 1);
    return { latest: latest ?? null };
  }

  /** Issue #19765 CFO v1 Issue J -- daily close run history. */
  async getCloseHistory(limit: number) {
    const client = getSupabaseClient(this.env);
    return { history: await listCfoDailyClose(client, limit) };
  }

  /** Issue #19768 CFO v1 Issue K -- tax-year year-end package. #19764 owns the dashboard UI;
   * this is the read endpoint for it (and for Ariel's CPA hand-off) to consume. */
  async getTaxPackage(year: number) {
    const client = getSupabaseClient(this.env);
    return await fetchTaxPackage(client, year);
  }

  /** Issue #19764 -- shared read of every viz data source, cached alongside the KPI
   * analysis bundle so the 6 /api/viz/* endpoints hitting the same request don't each
   * re-fetch bank_transactions/postings/journal_entries/accounts independently. */
  private async getVizData(forceRefresh = false) {
    const cached = !forceRefresh && (await this.ctx.storage.get<{ computedAt: string; data: VizDataBundle }>("viz_cache"));
    if (cached && Date.now() - Date.parse(cached.computedAt) < ANALYSIS_CACHE_TTL_MS) {
      return cached.data;
    }
    const client = getSupabaseClient(this.env);
    const [accounts, bankTxns, postings, journalEntries, ledgerAccounts] = await Promise.all([
      listVizBankAccounts(client),
      listAllVizBankTransactions(client),
      listVizPostings(client),
      listVizJournalEntries(client),
      listVizLedgerAccounts(client),
    ]);
    const data: VizDataBundle = { accounts, bankTxns, postings, journalEntries, ledgerAccounts };
    await this.ctx.storage.put("viz_cache", { computedAt: new Date().toISOString(), data });
    return data;
  }

  async getVizCash(entityParam: string | null, grainParam: string | null, fromParam: string | null, toParam: string | null) {
    const scope = resolveEntityScope(entityParam);
    const { accounts, bankTxns } = await this.getVizData();
    const scoped = accounts.filter((a) => scope.includes(a.entity_code));
    const earliest = bankTxns.reduce((min, t) => (t.posted_on < min ? t.posted_on : min), "9999-12-31");
    const { from, to } = resolveRange(fromParam, toParam, null, earliest === "9999-12-31" ? "2026-01-01" : earliest);
    const grain: Grain = parseGrain(grainParam);
    const txnsByAccount = new Map<string, typeof bankTxns>();
    for (const t of bankTxns) {
      if (!scoped.some((a) => a.id === t.bank_account_id)) continue;
      const arr = txnsByAccount.get(t.bank_account_id) ?? [];
      arr.push(t);
      txnsByAccount.set(t.bank_account_id, arr);
    }
    const result = computeCashSeries(scoped, txnsByAccount, grain, from, to, new Date().toISOString());
    return { entity: entityParam || "all", grain, from, to, ...result };
  }

  async getVizCashflow(entityParam: string | null, grainParam: string | null, fromParam: string | null, toParam: string | null) {
    const scope = resolveEntityScope(entityParam);
    const { accounts, bankTxns } = await this.getVizData();
    const scopedAccountIds = new Set(accounts.filter((a) => scope.includes(a.entity_code)).map((a) => a.id));
    const scopedTxns = bankTxns.filter((t) => scopedAccountIds.has(t.bank_account_id));
    const earliest = scopedTxns.reduce((min, t) => (t.posted_on < min ? t.posted_on : min), "9999-12-31");
    const { from, to } = resolveRange(fromParam, toParam, null, earliest === "9999-12-31" ? "2026-01-01" : earliest);
    const grain: Grain = parseGrain(grainParam);
    const buckets = computeCashflow(scopedTxns, grain, from, to);
    return { entity: entityParam || "all", grain, from, to, buckets };
  }

  async getVizBurn(entityParam: string | null) {
    const scope = resolveEntityScope(entityParam);
    const { accounts, postings, journalEntries, ledgerAccounts } = await this.getVizData();
    const cashOnHandCents = totalCashOnHandCents(accounts, scope);
    const client = getSupabaseClient(this.env);
    const recurring = await listRecurringCosts(client);
    const recurringRunrateDollars = recurring
      .filter((r) => scope.includes(r.entity_code as EntityCode))
      .reduce((s, r) => s + (r.monthly_runrate_dollars ?? 0), 0);
    const burn = computeBurn(postings, journalEntries, ledgerAccounts, scope, cashOnHandCents, recurringRunrateDollars);
    return { entity: entityParam || "all", ...burn };
  }

  async getVizCategories(entityParam: string | null, fromParam: string | null, toParam: string | null, periodParam: string | null) {
    const scope = resolveEntityScope(entityParam);
    const { bankTxns, postings, journalEntries, ledgerAccounts } = await this.getVizData();
    const earliest = journalEntries.reduce((min, e) => (e.entry_date < min ? e.entry_date : min), "9999-12-31");
    const { from, to } = resolveRange(fromParam, toParam, periodParam, earliest === "9999-12-31" ? "2026-01-01" : earliest);
    const bankTxnsById = indexBankTransactionsById(bankTxns);
    const { categories, topVendors } = computeCategories(postings, journalEntries, ledgerAccounts, bankTxnsById, scope, from, to);
    return { entity: entityParam || "all", from, to, categories, topVendors };
  }

  /** Issue #19764 -- recurring costs, entity-filtered wrapper around getRecurringCosts(). */
  async getVizRecurring(entityParam: string | null) {
    const scope = resolveEntityScope(entityParam);
    const { costs } = await this.getRecurringCosts();
    return { entity: entityParam || "all", costs: costs.filter((c) => scope.includes(c.entity_code as EntityCode)) };
  }

  /** Issue #19764 -- commingled costs (always ariel_personal-sourced by definition; entity
   * param filters by the *likely* business entity the cost should be reclassed to). */
  async getVizCommingled(entityParam: string | null) {
    const { costs } = await this.getCommingledCosts();
    if (!entityParam) return { entity: "all", costs };
    return { entity: entityParam, costs: costs.filter((c) => c.likely_business_entity === entityParam) };
  }

  /** Issue #19764 -- reconciliation exceptions, entity-filtered wrapper around getReconExceptions(). */
  async getVizExceptions(entityParam: string | null) {
    const scope = resolveEntityScope(entityParam);
    const { exceptions } = await this.getReconExceptions();
    return { entity: entityParam || "all", exceptions: exceptions.filter((e) => e.entity_code === null || scope.includes(e.entity_code as EntityCode)) };
  }

  /** Issue #19764 -- CFO chat, grounded only in the fixed read-only view catalog
   * (lib/chat.ts). Never executes model-authored raw SQL text -- the model emits a
   * structured {view, filters, groupBy} object validated against an allowlist and
   * translated deterministically into a PostgREST read, keeping the underlying execution
   * as read-only as every other endpoint on this Worker. */
  async postChat(question: string): Promise<ChatAnswer> {
    const client = getSupabaseClient(this.env);
    const viz = await this.getVizData();
    const answer = await answerCfoChatQuestion(client, question, this.env.DEEPSEEK_API_KEY, viz);
    const numbers = answer.numbers as { rows?: unknown[]; months?: unknown[]; buckets?: unknown[]; categories?: unknown[]; byAccount?: unknown[] };
    const rowCount = (numbers.rows ?? numbers.months ?? numbers.buckets ?? numbers.categories ?? numbers.byAccount ?? []).length;
    await logChatQuery(client, { entity: answer.entity, question, sql: answer.sql, refused: answer.refused, rowCount });
    return answer;
  }

  // Issue #19810 CFO v1 Issue M -- invoice audit capability. Reads go direct (cfo_agent_ro RLS
  // grant); writes go through the public.cfo_invoice_* SECURITY DEFINER RPCs (this Worker
  // holds no service_role key, same constraint documented at the top of ./lib/supabase.ts).

  async listInvoices() {
    const client = getSupabaseClient(this.env);
    return { invoices: await listInvoices(client) };
  }

  async getInvoiceDetail(invoiceId: string) {
    const client = getSupabaseClient(this.env);
    const result = await getInvoice(client, invoiceId);
    return result ?? { invoice: null, lines: [] };
  }

  async ingestInvoice(extracted: ExtractedInvoice, params: { entityCode: string | null; sourceFile: string | null; rawText: string; extractionMethod: string }) {
    const client = getSupabaseClient(this.env);
    const result = await ingestInvoice(client, extracted, params);
    // Best-effort: anomaly check runs immediately on ingest so a fresh invoice shows its
    // flags without a separate manual step. Never blocks the ingest response on failure.
    let anomalies: unknown = null;
    try {
      anomalies = await checkAnomalies(client, result.invoice_id);
    } catch (err) {
      anomalies = { error: String((err as Error).message ?? err) };
    }
    return {
      invoice_id: result.invoice_id,
      created: result.created,
      lines_inserted: result.lines_inserted,
      bank_transaction_id: result.bank_transaction_id,
      anomalies,
      extraction_method: params.extractionMethod,
      extracted,
    };
  }

  /** Dispatches each line to its vendor adapter (./lib/vendorAdapters.ts), persists whatever
   * the adapter returns via cfo_invoice_write_verification (never a fabricated number -- an
   * adapter with no credential returns UNVERIFIABLE, which is written as-is), flips the
   * invoice to status='verified' (meaning "reviewed," not "all lines matched"), then re-runs
   * the anomaly check now that variance_pct may be populated (rule 2). */
  async verifyInvoice(invoiceId: string) {
    const client = getSupabaseClient(this.env);
    const detail = await getInvoice(client, invoiceId);
    if (!detail) throw new Error(`no invoice ${invoiceId}`);

    const results = await verifyInvoiceLines(client, detail.invoice, detail.lines);
    for (const { line, result } of results) {
      await writeLineVerification(client, {
        lineId: line.id,
        verifiedQty: result.verified_qty,
        variancePct: result.variance_pct,
        verdict: result.verdict,
        evidence: result.evidence,
      });
    }
    await setInvoiceStatus(client, invoiceId, "verified");
    const anomalies = await checkAnomalies(client, invoiceId);
    const refreshed = await getInvoice(client, invoiceId);
    return { invoice: refreshed?.invoice ?? null, lines: refreshed?.lines ?? [], anomalies };
  }

  /** Tier 1 propose-only (issue non-goal: "No auto-sending any dispute or email to a vendor").
   * Persists the draft via cfo_invoice_save_dispute and returns it; nothing here sends
   * anything. `goodwillReason` lets the caller (index.ts) pass a known, already-remediated
   * root cause (e.g. the trigger case's GHA run-storm fix) so the draft asks for a goodwill
   * credit instead of disputing the vendor's meter when usage genuinely occurred. */
  async draftInvoiceDispute(invoiceId: string, goodwillReason: string | null) {
    const client = getSupabaseClient(this.env);
    const detail = await getInvoice(client, invoiceId);
    if (!detail) throw new Error(`no invoice ${invoiceId}`);

    const anomalies = await checkAnomalies(client, invoiceId).catch(() => ({ findings: [] as Array<{ line_id?: string; reason: string }> }));
    const findingByLineId = new Map(anomalies.findings.filter((f) => f.line_id).map((f) => [f.line_id as string, f.reason]));
    const lineContexts: DisputeLineContext[] = detail.lines.map((line) => ({ line, finding: findingByLineId.get(line.id) ?? null }));

    const { text, method } = await draftDispute(detail.invoice, lineContexts, goodwillReason, this.env.DEEPSEEK_API_KEY);
    await saveDisputeDraft(client, invoiceId, text);
    return { invoice_id: invoiceId, draft: text, method, sent: false };
  }

  /**
   * Stripe integration point — inert per issue #19646 item 5 (same Ariel-only gate as #19643).
   * No Stripe credentials exist in this stack; do not wire a real connection.
   */
  async getStripeStatus() {
    return {
      connected: false,
      reason: "No Stripe credentials configured. Connecting a real Stripe account is an Ariel-only gate (issue #19643) — never agent-executable.",
      integrationPoint: "inert",
    };
  }
}

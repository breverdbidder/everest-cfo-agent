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
} from "./lib/supabase";
import { computeKpiSnapshots, detectStatisticalAnomalies } from "./lib/kpi-engine";
import { computeCustomerProfiles, detectFraudPatterns } from "./lib/fraud";
import { computeScenarioStressTest, computeSurvivalAnalysis } from "./lib/survival";
import { calculateHealthScore } from "./lib/health-score";
import { runCashFlowForecast } from "./lib/cash-flow-forecaster";
import type { KPISnapshot } from "./lib/types";

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

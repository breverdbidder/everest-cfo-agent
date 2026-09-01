# Porting notes — Python (FastAPI/LangGraph) → Cloudflare Agents SDK (Workers/DO)

Issue: [breverdbidder/cli-anything-biddeed#19646](https://github.com/breverdbidder/cli-anything-biddeed/issues/19646).
Upstream source: [daniel-st3/ai-cfo-agent](https://github.com/daniel-st3/ai-cfo-agent).

## LICENSE finding (verified live, 2026-08-31)

`daniel-st3/ai-cfo-agent` has **no LICENSE file** at the repo root, and none has ever
existed in its git history (`git log --all --diff-filter=A --name-only | grep -i licens`
returns nothing at repo root — the only `LICENSE.md` hits are inside the vendored
`ui/ui-main` shadcn/ui submodule, unrelated to this project's own code). GitHub's API
correctly reports `license: null` because license detection requires an actual LICENSE
file, not README prose. `README.md` line ~382 states "License: MIT - fork it, deploy it,
build products on top of it" as prose text only — this is not a formal SPDX license
grant. Net effect: the repo is technically "all rights reserved" by default absence of a
license file, with an author statement of permissive intent that was never formalized.
Per issue #19646, this is not a blocking gate for Everest's internal-only use (Ariel +
the CFO agent only, confirmed 2026-08-31), but it should not be represented as "MIT
licensed" in any external-facing claim.

## What was faithfully ported (formulas/thresholds unchanged)

| Python source | TS port | Notes |
|---|---|---|
| `agents/analysis.py::compute_kpi_snapshots` | `src/lib/kpi-engine.ts::computeKpiSnapshots` | Weekly bucketing, MRR/ARR/churn/burn/gross-margin/CAC/LTV formulas verbatim |
| `agents/analysis.py::detect_fraud_patterns` | `src/lib/fraud.ts::detectFraudPatterns` | All 5 rules (round_number, velocity_spike, duplicate_amount, zero_revenue_week, contractor_ratio) — pure arithmetic, no substitution needed |
| `agents/analysis.py::compute_customer_profiles` | `src/lib/fraud.ts::computeCustomerProfiles` | Segment thresholds ($500/$150 weekly) verbatim |
| `agents/analysis.py::compute_survival_analysis` | `src/lib/survival.ts::computeSurvivalAnalysis` | Monte Carlo N=1000, 54-week horizon, cash-estimate formula, survival-score bands verbatim |
| `agents/analysis.py::compute_scenario_stress_test` | `src/lib/survival.ts::computeScenarioStressTest` | Bear/Base/Bull multipliers (0.80/1.15/0.30, 1.00/1.00/1.00, 1.20/0.85/2.50) verbatim |
| `agents/health_score.py::calculate_health_score` | `src/lib/health-score.ts::calculateHealthScore` | Component weights (30/20/20/15/15) and all threshold bands verbatim |
| `agents/cash_flow_forecaster.py::CashFlowForecaster` | `src/lib/cash-flow-forecaster.ts::runCashFlowForecast` | N=500 sims, 13 weeks, noise/drift formulas verbatim |

## Documented deviations

1. **sklearn IsolationForest + Chronos-T5 anomaly detection → IQR outlier detection.**
   Both require native ML runtimes (scikit-learn C extensions, a 40MB+ transformer model
   via `torch`) that cannot run inside a Workers V8 isolate. `detectStatisticalAnomalies()`
   in `kpi-engine.ts` is an honest replacement — same anomaly *contract* (metric,
   severity, expected range, description) — using IQR fences instead. This is a real
   algorithm substitution, not a faithful port; anomaly *counts and specific weeks
   flagged* will differ from the Python source.

2. **Anthropic API call → DeepSeek.** `health_score.py` calls
   `litellm.acompletion(model="anthropic/claude-haiku-3-5", ...)` directly. This repo's
   `CLAUDE.md` states `primary: Claude (Max plan, never API)` — calling the Anthropic API
   from application code is out of policy. `health-score.ts::getReasoning()` calls
   DeepSeek V3.2 instead (the sanctioned "cheap" tier per `CLAUDE.md`), with the same
   graceful fallback-to-static-text behavior the Python source has on failure. Falls back
   silently if `DEEPSEEK_API_KEY` is unset.

3. **Seeded RNG.** Python seeds `numpy.random.default_rng(42)` (PCG64). Workers has no
   numpy. `src/lib/rng.ts` uses Mulberry32 + Box-Muller, seeded with the same literal `42`
   for parity of *intent*, but the actual output sequence is not bit-identical to the
   Python source. Simulation *parameters* (N, horizon, distributions) are unchanged.

4. **Category taxonomy.** The Python demo's CSV rows use a fixed taxonomy
   (`salary_expense`, `software_expense`, `marketing_expense`, `cogs`, `tax_payment`,
   `contractor_expense`). The live `finance.expense_ledger.category` column is free text
   (currently just `saas_subscription` in production, 1 row as of 2026-08-31).
   `classifyExpenseCategory()` in `kpi-engine.ts` keyword-matches into the same five
   buckets so the KPI *formulas* are unchanged; unmatched categories fall into a new
   `other_expense` bucket that still contributes to burn_rate (so burn is always
   accurate) but not to gross_margin/CAC (which need the specific cogs/marketing
   buckets, correctly, per the original formula's intent).

5. **CashBalance / CommittedExpense tables don't exist in finance.\*.** The Python
   forecaster's primary path reads a `CommittedExpense` table that has no live-schema
   equivalent (issue #19646 lists only entities, revenue_ledger, expense_ledger,
   invoices, cfo_checkpoints). `runCashFlowForecast()` keeps the Python source's own
   *fallback* estimation path (current cash from trailing burn history) as the only path
   for now, and accepts `committedExpenses: CommittedExpense[] = []` so a future
   `finance.committed_expenses` table can be wired in without touching the math.

6. **"Run"-based CSV-upload model → live continuous read.** The Python API is built
   around a `run_id` (one uploaded CSV = one analysis run). There is no equivalent
   concept once the data source is a continuously-updated Supabase table (issue #19646
   item 3 mandates this switch). The Worker instead computes KPI snapshots from the
   *live* `finance.revenue_ledger` (status='invoiced' only — booked/REAL revenue,
   'pending' rows excluded from KPI math but still surfaced in the ledger view) +
   `finance.expense_ledger` on every request, cached for 120s in Durable Object storage
   (mirroring `health_score.py`'s in-memory TTL cache).

## Explicitly NOT ported this session (documented, not silently dropped)

The Python `api/main.py` exposes ~50 endpoints. Issue #19646 scopes this rewrite to "the
KPI engine, runway/burn analysis, and fraud-detection logic" — the following are real,
substantial Python modules that were **not** ported in this session and would need their
own scoping pass:

- `agents/board_deck_generator.py` (23KB) — PDF board deck generation
- `agents/insight_writer.py` (33KB) — LLM-authored board briefings, VC memos, investor
  updates (also calls the Anthropic API directly — same policy conflict as health_score.py)
- `agents/market_agent.py` — competitor signal scraping (Tavily/DuckDuckGo)
- `agents/quickbooks_sync.py`, `agents/stripe_sync.py` — full sync logic (Stripe wired as
  an inert stub only, per issue #19646 item 5; QuickBooks is out of scope entirely per
  the sibling issue #19643's "no paid SaaS" rule)
- `agents/autonomous_cfo.py`, `agents/perception.py`, `agents/planning.py`,
  `agents/reasoning.py`, `agents/executor.py`, `agents/agent_memory.py` — the
  perceive/reason/plan/execute/learn autonomous loop (`graph/cfo_graph.py`'s LangGraph
  orchestration). The single `CfoAgent` Durable Object class in this rewrite handles
  request/response analysis only, not an autonomous background loop.
- `agents/deferred_revenue.py` — deferred revenue schedule
- `agents/morning_briefing.py` — scheduled briefing generation

These are flagged here so they don't silently disappear from scope; a follow-up issue
should explicitly decide which (if any) get ported.

## Postgres role `cfo_agent_ro` (created 2026-08-31, live-verified)

```sql
CREATE ROLE cfo_agent_ro NOLOGIN NOINHERIT;
GRANT USAGE ON SCHEMA finance TO cfo_agent_ro;
GRANT USAGE ON SCHEMA winnerdata TO cfo_agent_ro;
GRANT SELECT ON finance.entities, finance.revenue_ledger, finance.expense_ledger,
  finance.invoices, finance.cfo_checkpoints TO cfo_agent_ro;
GRANT SELECT ON winnerdata.billable_ff_events, winnerdata.v_billable_ff_comparison,
  winnerdata.wallets TO cfo_agent_ro;
GRANT cfo_agent_ro TO authenticator;
```

Verified live via `pg_roles` (`rolcanlogin=false`, `rolinherit=false`,
`rolbypassrls=false`) and `information_schema.role_table_grants` (exactly the 8
SELECT grants above, no more). A Supabase "secret" API key
(`sb_secret_FN22d...`, id `cad22341-1fcf-4432-b7ce-8b343a5c8720`, name
`cfo_agent_worker`) was created via the Management API with
`secret_jwt_template: {"role": "cfo_agent_ro"}` and stored as the
`CFO_AGENT_SUPABASE_KEY` repo secret — **never the service_role key**, per issue
#19646 item 3.

**Known open issue (found 2026-08-31, RESOLVED 2026-09-01 — see below):** as of the
2026-08-31 session, the newly-created scoped key returned `401 Invalid API key`
against `$SUPABASE_URL/rest/v1/...` even after a 15-minute propagation wait, while a
pre-existing `secret`-type key (created Nov 2025, same project) still authenticated
successfully — proven via a same-request control test. A second, disposable
`service_role`-templated key created via the same Management API call *also* failed
identically, which ruled out anything specific to the custom `cfo_agent_ro` role
template.

## 2026-09-01 fix (issue #19710) — full root-cause chain

The dashboard went live 2026-09-01 and every `/api/*` call 500'd with
`"... list failed: Invalid API key"`. Investigation found **three independent,
stacked blockers**, all now fixed:

### Bug 1 — the `sb_secret_` key authenticates inconsistently by network origin

Retesting the exact same `cfo_agent_worker` key (`sb_secret_FN22d...`, revealed via
`GET /v1/projects/{ref}/api-keys?reveal=true`) ~36h after creation showed it now
returns `200` from *some* callers and `401 Invalid API key` from others, **for the
same key value at the same moment**:

| Caller | Result |
|---|---|
| `cli-anything-biddeed` GHA runner (direct curl) | `200`, real data |
| `everest-cfo-agent` GHA runner (direct curl, isolated diagnostic workflow) | `401` |
| Deployed Cloudflare Worker (`everest-cfo-agent.brevardbidderai.workers.dev`) | `401` |

This is not "wait longer" — it is a genuine Supabase platform inconsistency specific
to Management-API-minted `secret`-type keys, most likely uneven cache state across
Kong gateway nodes/edges. **Conclusion: do not rely on `sb_secret_`-type keys for
this project until Supabase confirms the gateway-side caching is fixed.**

### Bug 2 — `finance`/`winnerdata` were never in PostgREST's exposed-schema list

`GET /v1/projects/{ref}/postgrest` showed `db_schema: "public,graphql_public,geo_tracker"`
— `finance` and `winnerdata` were never exposed at all, independent of the key
problem (confirmed via `PGRST106 Invalid schema` using the known-good
`service_role` key). Worse: PATCHing `db_schema` via the Management API, and even
two full project restarts (`soft` then `hard`), had **zero effect** on the live
gateway. Root cause: `pg_db_role_setting` had a **database-level override**,
`ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, pascal,
geo_tracker'` (the `pascal` schema is unrelated pre-existing state, left in place),
which takes precedence over the Dashboard/Management-API-managed config entirely and
is invisible from the Management API. Fixed via:
```sql
ALTER ROLE authenticator SET pgrst.db_schemas =
  'public, graphql_public, pascal, geo_tracker, finance, winnerdata';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
```
**If this project's exposed-schema list ever needs to change again, edit the
`ALTER ROLE authenticator SET pgrst.db_schemas` value directly — the Dashboard
"Exposed schemas" setting will not take effect while this override exists.**

### Bug 3 — RLS enabled with zero policies on the target tables

`finance.revenue_ledger`, `finance.expense_ledger`, `finance.invoices`,
`winnerdata.billable_ff_events`, and `winnerdata.wallets` all have
`relrowsecurity=true` with **no policies at all** (`finance.cfo_checkpoints` and
`finance.entities` have RLS disabled, so they were unaffected). Default-deny RLS
means even a perfectly authenticated `cfo_agent_ro` request would return `200` with
an **empty array**, not an error — this would have looked like "the fix didn't
work" with no error message to diagnose from. Fixed additively (existing policies
on other roles untouched) via:
```sql
CREATE POLICY cfo_agent_ro_select ON finance.revenue_ledger FOR SELECT TO cfo_agent_ro USING (true);
CREATE POLICY cfo_agent_ro_select ON finance.expense_ledger FOR SELECT TO cfo_agent_ro USING (true);
CREATE POLICY cfo_agent_ro_select ON finance.invoices FOR SELECT TO cfo_agent_ro USING (true);
CREATE POLICY cfo_agent_ro_select ON winnerdata.billable_ff_events FOR SELECT TO cfo_agent_ro USING (true);
CREATE POLICY cfo_agent_ro_select ON winnerdata.wallets FOR SELECT TO cfo_agent_ro USING (true);
```

### The actual auth fix — anon `apikey` + self-signed `cfo_agent_ro` JWT `Authorization`

Because Bug 1 shows the `sb_secret_` key type is unreliable on this project
regardless of schema/RLS state, `src/lib/supabase.ts` no longer uses it. Instead:

- **`apikey` header** = the project's legacy `anon` key (`CFO_AGENT_SUPABASE_ANON_KEY`).
  This only has to pass Kong's gateway-identity check — Kong's legacy-JWT
  verification path was the one origin-consistent path found during diagnosis.
  `anon` itself has zero grants on `finance`/`winnerdata`, so holding it is not a
  privilege escalation risk even if leaked.
- **`Authorization` header** = a long-lived (10-year) self-signed HS256 JWT,
  `{"role": "cfo_agent_ro", "iss": "supabase", "iat": ..., "exp": ...}`, signed with
  the project's **legacy JWT secret** (`GET /v1/projects/{ref}/postgrest` →
  `jwt_secret` field — same mechanism Supabase's own `anon`/`service_role` legacy
  keys are signed with). This is what PostgREST actually uses to pick the effective
  Postgres role; it is verified locally against `jwt_secret` on every request, with
  no external key-registry lookup, which is why it was consistent across all three
  network origins in testing (unlike Bug 1's `sb_secret_` key).
  Stored as `CFO_AGENT_SUPABASE_KEY` (same secret name, new value/meaning).

`getSupabaseClient()` wires this via `createClient(url, anonKey, { global: { headers:
{ Authorization: \`Bearer ${cfoAgentRoJwt}\` } } })` — confirmed against a local HTTP
server that supabase-js sends `apikey: <anon>` and `authorization: Bearer <jwt>` as
two independent headers with this construction, then confirmed live against
PostgREST directly (all 5 target tables, `200` with real rows) and against a
temporary diagnostic GitHub Actions workflow run from the `everest-cfo-agent` repo
(the network origin where the old key failed).

**Old `cfo_agent_worker` Management-API key** (`sb_secret_FN22d...`, id
`cad22341-1fcf-4432-b7ce-8b343a5c8720`) was left in place (not deleted) rather than
revoked, in case Supabase's inconsistency turns out to be time-bounded and the key
type becomes usable again later — it is simply no longer referenced by
`CFO_AGENT_SUPABASE_KEY`.

**Rotation note for future sessions:** the JWT has a 10-year expiry and is not tied
to any Supabase UI state, so it will not silently expire soon — but if
`jwt_secret` is ever rotated (Supabase dashboard → Settings → API → JWT Settings →
"Rotate"), every previously-minted JWT signed with the old secret stops verifying
immediately, including this one. There is no automatic alert for this; if
`/api/*` starts 500ing with `Invalid API key` or `JWSError` again, re-fetch
`jwt_secret` from `GET /v1/projects/{ref}/postgrest` and re-mint before assuming
it's Bug 1 recurring.

# Everest CFO Agent — Cloudflare Agents SDK rewrite

Rebuild of [daniel-st3/ai-cfo-agent](https://github.com/daniel-st3/ai-cfo-agent)'s Python
(FastAPI + LangGraph) backend on Cloudflare's [Agents SDK](https://developers.cloudflare.com/agents/)
(Workers + Durable Objects), per [issue #19646](https://github.com/breverdbidder/cli-anything-biddeed/issues/19646).
Single agent class (`CfoAgent`, `src/agent.ts`) replaces the LangGraph orchestration graph.

See [`docs/PORTING_NOTES.md`](docs/PORTING_NOTES.md) for exactly what was ported verbatim,
what was deliberately substituted (and why), and what was explicitly left out of this
session's scope.

## Architecture

```
Browser ──▶ Worker (src/index.ts)
              ├─ /            static dashboard shell (public/) — no auth, no data
              └─ /api/*       gated by X-CFO-Secret header (auth.ts)
                     └─▶ CfoAgent Durable Object (src/agent.ts)
                              ├─ Supabase JS client, scoped `cfo_agent_ro` Postgres role
                              │    (finance.*, winnerdata.* — read-only, never service_role)
                              ├─ lib/kpi-engine.ts       — MRR/ARR/churn/burn/CAC/LTV
                              ├─ lib/fraud.ts            — 5 rule-based fraud checks
                              ├─ lib/survival.ts         — Monte Carlo runway + bear/base/bull
                              ├─ lib/health-score.ts     — composite 0-100 score + DeepSeek reasoning
                              ├─ lib/cash-flow-forecaster.ts — 13-week P10/P50/P90 forecast
                              └─ 120s cache in Durable Object storage
```

## Local development

```bash
cd worker
npm install
npx tsc --noEmit          # type check
npx wrangler dev          # local dev server (needs .dev.vars — see wrangler.toml comments)
npx wrangler deploy --dry-run   # verify bundling without deploying
```

## Deploy

`.github/workflows/deploy.yml` deploys on push to `main` (paths under `worker/**`) or via
`workflow_dispatch`. Requires these repo secrets:

| Secret | Purpose | Status as of 2026-08-31 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers deploy permission | **missing** — deploy will fail until added |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account | **missing** — deploy will fail until added |
| `CFO_AGENT_SUPABASE_URL` | Supabase project URL | set |
| `CFO_AGENT_SUPABASE_ANON_KEY` | legacy `anon` key — used only for the `apikey` gateway header | set 2026-09-01 |
| `CFO_AGENT_SUPABASE_KEY` | long-lived self-signed JWT, `{role: cfo_agent_ro}` — used as the `Authorization` header | set 2026-09-01, replaces the Management-API "secret" key from 2026-08-31 (see PORTING_NOTES.md) |
| `CFO_AGENT_SHARED_SECRET` | single-user access gate | set (freshly generated) |
| `DEEPSEEK_API_KEY` | health-score reasoning text | optional — falls back to static text if unset |

## Cost

Durable Objects require the Cloudflare Workers **Paid plan, $5/month minimum**. This is a
new recurring cost beyond anything already in the BidDeed/Everest stack — see issue
#19646's cost-disclosure requirement. Nothing else in this app has a variable cost;
Supabase reads are within the existing project's included quota, and DeepSeek calls (if
`DEEPSEEK_API_KEY` is set) are pay-per-token at ~$0.28/1M tokens, well under $1/month at
this app's request volume.

## Access control

Single-user (Ariel + the agent itself). The static dashboard shell is public (no data);
every `/api/*` call requires the `X-CFO-Secret` header, checked in `auth.ts` with a
constant-time comparison. The dashboard's in-page gate form stores the key in
`sessionStorage` only (never persisted, never in the URL after entry). This is
deliberately not a full auth system — issue #19646 item 6 explicitly asks for the
simplest workable single-user gate, not multi-user auth.

## Stripe

`GET /api/integrations/stripe/status` is a clearly-marked inert integration point
(`agent.ts::getStripeStatus`). No Stripe credentials exist anywhere in this stack;
connecting a real account is an Ariel-only gate, same as issue #19643.

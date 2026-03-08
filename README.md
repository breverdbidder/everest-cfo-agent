# AI CFO Agent - Financial Intelligence Platform

[![GitHub stars](https://img.shields.io/github/stars/daniel-st3/ai-cfo-agent?style=social)](https://github.com/daniel-st3/ai-cfo-agent/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **The AI CFO that 99% of startups can't afford - now open source.**

Drop a CSV of weekly transactions and get a board-ready finance cockpit in ~30 seconds: a live **Financial Health Score**, KPI command center, runway and Monte Carlo survival analysis, competitor intel, AI reports, and a new **AI CFO Decision Engine** that recommends actions, simulates impact across the dashboard, saves scenarios, and exports a shareable board snapshot. Optimized for low-cost inference at **~$0.003 per run**, with the decision layer itself running rules-first to avoid extra API spend.

---

## Product Tour

### Landing and Upload Flow

![Landing page with upload flow and live demo trigger](docs/screenshots/01-landing.png)

Landing page with upload, demo trigger, and CFO stack integrations.

### Progressive Dashboard Loading

![Real demo run progressively loading the dashboard](docs/linkedin-assets/progressive-loading.gif)

Real streamed run: sections appear progressively while the pipeline completes.

### Decision Engine

![AI CFO Decision Engine with live scenario impact](docs/screenshots/07-decision-engine.png)

Decision engine with live scenario impact, proof chips, and clickable actions.

### Runway Explorer

![Runway explorer and forecast view](docs/screenshots/05-runway-explorer.png)

Runway controls, modeled scenarios, and cash forecast views.

### Autonomous Monitoring

![Autonomous CFO Agent activity panel](docs/screenshots/03-autonomous-agent.png)

Autonomous monitoring and agent activity in the dashboard.

### AI Report Output

![AI Intelligence Center reports](docs/screenshots/04-ai-intelligence-center.png)

Board-facing AI reports and generated output panels.

## Real-Time Pipeline Output

### Live Agent Log

![Live pipeline agent log from a real demo run](docs/linkedin-assets/agent-log.png)

Actual pipeline agent log with timestamps, agent names, and 5% -> 100% progress.

### WebSocket Event Frames

![WebSocket pipeline event frames from a real streamed run](docs/linkedin-assets/websocket-events.png)

Actual streamed frames from `POST /demo/async` and `ws://localhost:8000/ws/pipeline/<run_id>`.

The GIF and pipeline assets in this section were generated from live local runs with:

```bash
python3 scripts/generate_linkedin_assets.py
```

---

## Featured Capabilities

| Category | Feature |
|---|---|
| **Health Score** | Real-time 0-100 composite score (runway + burn + growth + unit econ + risk) with live Claude Haiku reasoning - cached 2 min, refreshable |
| **KPI Engine** | 7 KPI cards (MRR, ARR, Burn, Gross Margin, Churn, CAC, LTV) + click-to-expand deep-dive charts |
| **Survival** | Monte Carlo (10K simulations) → ruin probability at 90d / 180d / 365d |
| **Runway** | Horizontal fuel-gauge bar + cut-burn / grow-MRR sliders with per-lever impact chips |
| **Decision Engine** | Rules-first AI CFO Decision Engine ranks the top moves this week, explains why, and applies them across runway, scenarios, and cash flow with zero extra paid API calls |
| **Scenario Vault** | Save recommended plans to the backend per run so they survive refreshes and can be reloaded later |
| **Board Snapshot** | Export the current plan as PNG, HTML, print view, or copyable board summary |
| **Morning Briefing** | 7 AM proactive text: runway, urgent alerts, 3 AI actions + iMessage preview in dashboard |
| **Scenarios** | Bear / Base / Bull stress test with Series A readiness verdict |
| **AI Reports** | Board Q&A (8 adversarial VC questions), CFO Report, VC Verdict, Investor Update |
| **CFO Chat** | Multi-turn board prep chat grounded in your live KPI data |
| **Pre-mortem** | 3 failure scenarios (financial / market / operational) with prevention actions |
| **Fundraising** | 5-dimension readiness score: MRR growth, GM, LTV:CAC, runway, churn |
| **Cap Table** | Dilution simulator: pre-money → post-money, share price, founder % |
| **Compliance** | Autopilot: ASC 606, 1099 risk, round-number transactions, data gaps |
| **Benchmarker** | Anonymous industry percentile comparison (SaaStr / OpenView / a16z data) |
| **Fraud Detection** | ML pattern detection: velocity spikes, round numbers, contractor ratio |
| **Anomaly Detection** | IsolationForest + rules-based, deduplicated & severity-ranked |
| **Customer Matrix** | Scatter segmentation: Stars / At Risk / Growing / Watch quadrants |
| **Competitor Intel** | Threat radar + hiring signals + pricing scraping (DuckDuckGo, free) |
| **Cash Flow Forecast** | 13-week P10/P50/P90 probabilistic forecast |
| **Deferred Revenue** | GAAP ASC 606 recognition schedule for annual contracts |
| **Board Deck** | 10-slide PowerPoint generation |
| **Integrations** | Stripe sync + QuickBooks OAuth |
| **Multi-file Upload** | Merge multiple CSVs in one analysis run |
| **Alembic Migrations** | Schema migrations for safe production deployments |
| **Autonomous Agent** | 5-component agent loop: perceive → reason (Claude tool_use) → plan → execute → learn |

---

## Quickstart

```bash
# 1. Clone
git clone https://github.com/daniel-st3/ai-cfo-agent.git
cd ai-cfo-agent

# 2. Install backend dependencies
pip install -e ".[ml]"          # ml group = scikit-learn, chronos (optional)

# 3. Configure - get your free API key at https://console.anthropic.com/keys
cp .env.example .env
# Open .env and set: ANTHROPIC_API_KEY=sk-ant-your-key-here
# All other keys are optional (see API Keys section below)

# 4. Run database migrations
alembic upgrade head

# 5. Start backend
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# 6. Start frontend (new terminal)
cd frontend && npm install && npm run dev
```

Open **http://localhost:3000** and click **Run Demo** - no file upload needed.

This repo does **not** use `pipenv`. If you are working from the project-local virtualenv, the equivalent backend command is `.venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000`.

---

## API Keys

| Key | Required | Purpose | Cost |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | Claude Haiku for all AI reports + agent reasoning | ~$0.001-0.008/run |
| `TAVILY_API_KEY` | No | Competitor news (DuckDuckGo fallback) | Free tier |
| `DATABASE_URL` | No | PostgreSQL (SQLite default) | Free |
| `REDIS_URL` | No | Background tasks (Celery) | Free |
| `SLACK_WEBHOOK_URL` | No | Agent Slack notifications | Free |
| Stripe / QuickBooks | No | Live transaction sync | Free OAuth |

---

## CSV Format

```csv
date,category,amount,customer_id
2024-01-07,subscription_revenue,12500.00,acme_corp
2024-01-07,salary_expense,-18000.00,
2024-01-07,marketing_expense,-4500.00,
2024-01-07,cogs,-3200.00,
```

**Valid categories**: `subscription_revenue` · `churn_refund` · `salary_expense` · `marketing_expense` · `cogs` · `software_expense` · `tax_payment`

Download a blank template from the upload page or `GET /analyze/template`.

---

## Example Upload Files

Need realistic files for a demo, GitHub download, or manual upload test? Use the five examples in [`examples/uploads`](examples/uploads):

- `saas_recovery_arc.csv`
- `fintech_runway_reset.csv`
- `healthtech_enterprise_mix.csv`
- `marketplace_margin_crunch.csv`
- `devtools_plg_growth.csv`

They all match the live upload schema, so you can drag them straight into the app.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Next.js 15 App Router (port 3000)                       │
│  ├── / (upload + pipeline animation)                     │
│  ├── /run/[runId] (full dashboard - 14 sections)         │
│  └── /integrations/stripe · /integrations/quickbooks    │
└──────────────────────┬──────────────────────────────────┘
                       │  REST  (NEXT_PUBLIC_API_URL)
┌──────────────────────▼──────────────────────────────────┐
│  FastAPI (port 8000) + LangGraph pipeline                │
│                                                          │
│  POST /demo             → sample data, full pipeline     │
│  POST /analyze          → upload CSV, full pipeline      │
│  POST /report           → CFO briefing (Claude Haiku)    │
│  POST /board-prep       → adversarial Q&A (Claude Haiku) │
│  POST /vc-memo          → VC investment memo             │
│  POST /investor-update  → monthly LP update email        │
│  POST /pre-mortem       → 3 failure scenarios            │
│  POST /board-prep/chat  → multi-turn CFO chat            │
│  POST /briefing/preview → morning CFO briefing preview   │
│  POST /agent/{id}/cycle → trigger autonomous agent cycle │
│  GET  /agent/{id}/status → observation + action feed     │
│  POST /agent/actions/{id}/approve → approve action       │
│  GET  /benchmarks       → industry percentile comparison │
│  GET  /runs/{id}/...    → KPIs · anomalies · signals     │
│                                                          │
│  agents/analysis.py        KPI, IsolationForest, Monte Carlo│
│  agents/insight_writer     Claude Haiku AI reports       │
│  agents/market_agent       Competitor intel (free APIs)  │
│  agents/ingestion.py       CSV / PDF parsing             │
│  agents/morning_briefing   Proactive daily CFO briefing  │
│  agents/stripe_sync        Stripe subscription data      │
│  agents/quickbooks_sync    QuickBooks P&L data           │
│  agents/autonomous_cfo.py  Autonomous agent orchestrator │
│  agents/perception.py      Financial state observer      │
│  agents/reasoning.py       Claude tool_use decision maker│
│  agents/planning.py        Multi-step action planner     │
│  agents/executor.py        Action runner (Slack/email)   │
│  agents/agent_memory.py    PostgreSQL outcome memory     │
│                                                          │
│  SQLite (dev) / PostgreSQL (prod) via Alembic migrations │
└─────────────────────────────────────────────────────────┘

Autonomous Agent Loop (runs on-demand or via Celery Beat):
  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
  │ Perceive │ → │  Reason  │ → │   Plan   │ → │ Execute  │ → │  Learn   │
  │ KPI + DB │   │ Claude   │   │ template │   │ Slack /  │   │ Postgres │
  │ snapshot │   │ tool_use │   │ actions  │   │ approval │   │ outcomes │
  └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

---

## Real-Time Streaming Architecture

The pipeline uses **WebSocket streaming** for real-time progress - with automatic polling fallback for restricted environments (corporate firewalls, proxies).

```
Frontend (Next.js)
  │
  ├── 1. Generates run_id (crypto.randomUUID)
  ├── 2. Calls POST /demo/async?run_id=... → returns immediately
  ├── 3. Navigates to /run/{runId} dashboard
  └── 4. usePipelineStream hook connects WebSocket
         ws://localhost:8000/ws/pipeline/{runId}
               │
               │  real-time events
               ▼
FastAPI WebSocket endpoint (/ws/pipeline/{run_id})
  │
  └── ConnectionManager (pub/sub, per run_id)
        ▲
        │  publish_event()
        │
LangGraph pipeline nodes (in order):
  _router_node       → pipeline_started      (0%)
  _ingestion_node    → agent_started/completed (5%→20%)
  _persist_raw_node  → agent_started/completed (22%→30%)
  _analysis_node     → agent_started/completed (32%→75%)
  _market_analyze_node → agent_started/completed (77%→95%)
  run_analyze()      → pipeline_completed    (100%)
```

**Event payload example:**
```json
{"event_type": "agent_completed", "agent_name": "AnalysisAgent",
 "progress": 75, "message": "KPIs computed - MRR $25,500, 5 anomalies detected",
 "data": {"mrr": 25500, "gross_margin": 0.73, "anomaly_count": 5}}
```

**Graceful degradation:** if WebSocket fails to open within 5 s, `usePipelineStream` auto-switches to polling `GET /runs/{runId}/status` every 2 s and synthesises equivalent events - the dashboard UI is identical regardless of transport.

**Configuration** (`frontend/.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000   # use wss:// in production
```

**Interview talking points this demonstrates:**
- Event-driven pub/sub architecture (ConnectionManager pattern)
- Production-grade graceful degradation (WebSocket → polling fallback)
- Async Python: FastAPI WebSocket + LangGraph background task coexist cleanly
- React hooks with real-time state management (`usePipelineStream`)
- Config management via environment variables (no hardcoded URLs)
- Backward-compatible API design: existing REST endpoints unchanged

---

## Demo Data

78-week synthetic B2B SaaS dataset with a realistic crisis/recovery arc:

| Act | Weeks | Story |
|---|---|---|
| 1 | 1-12 | Healthy growth, <0.5% weekly churn |
| 2 | 13-26 | Crisis: 3 enterprise churns, marketing panic, burn spikes to $45K/wk |
| 3 | 27-38 | Near-death: new mid-market wins, team right-sizing |
| 4 | 39-55 | Recovery: 2 enterprise re-signs, MRR climbs back |
| 5 | 56-78 | Hypergrowth: 3 more enterprise wins, MRR hits $42K/wk |

Regenerate: `python3 data/gen_drama.py`

---

## GitHub Upload Safety

The repo is set up so local secrets and databases stay out of version control:

- `.env`, `.env.local`, `frontend/.env.local`, and `*.env` are ignored.
- Local SQLite files like `ai_cfo.db` are ignored.
- Commit `.env.example`, not your real `.env`.

Before pushing, run:

```bash
git ls-files '.env*' 'frontend/.env.local' 'ai_cfo.db'
rg -n '(ANTHROPIC_API_KEY|TAVILY_API_KEY|SLACK_WEBHOOK_URL|sk-ant-|xoxb-|AKIA|AIza)' \
  --glob '!node_modules' --glob '!.venv' --glob '!.git'
```

---

## Cost Breakdown

| Component | Cost |
|---|---|
| Claude Haiku (all AI reports per run) | ~$0.003-0.025 |
| Morning briefing (Claude Haiku) | ~$0.003/day per user |
| **Autonomous agent cycle (Claude Haiku)** | **~$0.003/cycle** |
| SMS delivery (Twilio) | ~$0.01/message ([free trial](https://www.twilio.com/try-twilio)) |
| Email delivery (SendGrid) | $0 ([free tier](https://sendgrid.com/pricing/): 100 emails/day) |
| Competitor news (DuckDuckGo) | $0 |
| Hiring signals (DuckDuckGo) | $0 |
| Pricing scrape (httpx + BeautifulSoup) | $0 |
| Anomaly detection (IsolationForest) | $0 |
| Monte Carlo survival (NumPy) | $0 |
| **Total per run** | **~$0.003-0.025** |
| **Daily briefing + hourly agent** | **~$0.085-0.10/user/day** |

---

## Production Deployment

```bash
# Run database migrations
alembic upgrade head

# Set environment variables
export DATABASE_URL=postgresql+asyncpg://user:pass@host/ai_cfo
export ANTHROPIC_API_KEY=sk-ant-...
export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...  # optional

# Start API (2 workers)
gunicorn api.main:app -k uvicorn.workers.UvicornWorker -w 2 --bind 0.0.0.0:8000

# Build frontend
cd frontend && npm run build && npm start

# Optional: hourly autonomous agent via cron
# 0 * * * * curl -X POST https://your-api.com/agent/{run_id}/cycle
```

---

## Project Layout

```
agents/          KPI engine, insight writer, market agent, ingestion, autonomous agent
api/             FastAPI app, models, schemas, DB manager
graph/           LangGraph orchestration
frontend/        Next.js 15 App Router dashboard
data/            Demo CSV + competitor profiles + industry benchmarks
examples/uploads Realistic sample CSVs for the upload box
alembic/         Database migration scripts
scripts/         Playwright visual check, morning briefing cron script
docs/            Screenshots
```

---

## License

MIT - fork it, deploy it, build products on top of it. Star the repo if it saves you time. ⭐

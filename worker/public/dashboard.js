const KEY_STORAGE = "cfo_agent_key";

function getKey() {
  return sessionStorage.getItem(KEY_STORAGE) || "";
}

function showGate() {
  document.getElementById("gate").style.display = "block";
  document.getElementById("app").style.display = "none";
}

function showApp() {
  document.getElementById("gate").style.display = "none";
  document.getElementById("app").style.display = "block";
}

async function apiFetch(path) {
  const resp = await fetch(path, { headers: { "X-CFO-Secret": getKey() } });
  if (resp.status === 401) {
    sessionStorage.removeItem(KEY_STORAGE);
    showGate();
    throw new Error("unauthorized");
  }
  if (!resp.ok) throw new Error(`${path} -> HTTP ${resp.status}`);
  return resp.json();
}

function fmtUsd(n) {
  if (n === null || n === undefined) return "—";
  return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtPct(n) {
  if (n === null || n === undefined) return "—";
  return (Number(n) * 100).toFixed(1) + "%";
}

function card(label, value, extraClass) {
  return `<div class="card"><div class="label">${label}</div><div class="value ${extraClass || ""}">${value}</div></div>`;
}

async function renderHealth() {
  try {
    const { health } = await apiFetch("/api/health-score");
    const el = document.getElementById("health-cards");
    if (!health) {
      el.innerHTML = card("Status", "No data yet");
      return;
    }
    el.innerHTML =
      card("Score", `${health.score}/100`, `status-${health.status}`) +
      card("Status", health.status.toUpperCase(), `status-${health.status}`) +
      card("Runway component", health.components.runway) +
      card("Burn stability", health.components.burnStability) +
      card("Revenue growth", health.components.revenueGrowth) +
      card("Unit economics", health.components.unitEconomics) +
      card("Risk factors", health.components.riskFactors) +
      `<div class="card" style="grid-column: 1 / -1"><div class="label">Assessment</div><div style="font-size:14px;line-height:1.5">${health.reasoning}</div></div>`;
  } catch (e) {
    console.error(e);
  }
}

async function renderKpis() {
  try {
    const { latest, weekCount } = await apiFetch("/api/kpis");
    const el = document.getElementById("kpi-cards");
    if (!latest) {
      el.innerHTML = card("Status", `No weekly data yet (${weekCount} weeks)`);
      return;
    }
    el.innerHTML =
      card("MRR", fmtUsd(latest.mrr)) +
      card("ARR", fmtUsd(latest.arr)) +
      card("Burn rate / wk", fmtUsd(latest.burnRate)) +
      card("Churn rate", fmtPct(latest.churnRate)) +
      card("Gross margin", fmtPct(latest.grossMargin)) +
      card("CAC", fmtUsd(latest.cac)) +
      card("LTV", fmtUsd(latest.ltv));
  } catch (e) {
    console.error(e);
  }
}

async function renderRunway() {
  try {
    const { survival, scenarios } = await apiFetch("/api/runway");
    const el = document.getElementById("runway-cards");
    let html = "";
    if (survival) {
      html += card("Survival score", `${survival.score}/100 — ${survival.label}`);
      html += card("Fundraising deadline", survival.fundraisingDeadline || "n/a");
    } else {
      html += card("Survival analysis", "Insufficient history (need ≥3 weeks)");
    }
    for (const s of scenarios) {
      html += card(`${s.scenario.toUpperCase()} runway`, `${s.monthsRunway} mo`);
    }
    el.innerHTML = html;
  } catch (e) {
    console.error(e);
  }
}

async function renderFraud() {
  try {
    const { fraudAlerts } = await apiFetch("/api/fraud-alerts");
    const tbody = document.querySelector("#fraud-table tbody");
    tbody.innerHTML = fraudAlerts.length
      ? fraudAlerts
          .map(
            (a) =>
              `<tr><td>${a.weekStart}</td><td>${a.category}</td><td>${a.pattern}</td><td class="severity-${a.severity}">${a.severity}</td><td>${a.description}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="5" style="color:var(--text-dim)">No fraud patterns detected</td></tr>`;
  } catch (e) {
    console.error(e);
  }
}

async function renderLedgers() {
  try {
    const { revenue, expenses } = await apiFetch("/api/ledgers");
    document.querySelector("#revenue-table tbody").innerHTML = revenue.length
      ? revenue
          .map(
            (r) =>
              `<tr><td>${r.occurred_on}</td><td>${r.customer}</td><td>${r.source}</td><td>${fmtUsd(r.amount_cents / 100)}</td><td>${r.status}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="5" style="color:var(--text-dim)">No revenue rows</td></tr>`;

    document.querySelector("#expense-table tbody").innerHTML = expenses.length
      ? expenses
          .map(
            (e) =>
              `<tr><td>${e.incurred_on}</td><td>${e.vendor}</td><td>${e.category}</td><td>${fmtUsd(e.amount_cents / 100)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4" style="color:var(--text-dim)">No expense rows</td></tr>`;
  } catch (e) {
    console.error(e);
  }
}

async function renderBillable() {
  try {
    const { events, wallets } = await apiFetch("/api/billable-ff");
    document.querySelector("#billable-table tbody").innerHTML = events.length
      ? events
          .map(
            (e) =>
              `<tr><td>${e.delivered_at}</td><td>${e.org_id}</td><td>${e.monetization_tier_met}</td><td>${e.bound_at || "—"}</td>` +
              `<td>${fmtUsd((e.scenario_a_delivery_fee_cents + e.scenario_a_success_fee_cents) / 100)}</td>` +
              `<td>${fmtUsd(e.scenario_b_flat_fee_cents / 100)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="6" style="color:var(--text-dim)">No billable FF events</td></tr>`;

    document.querySelector("#wallets-table tbody").innerHTML = wallets.length
      ? wallets
          .map(
            (w) =>
              `<tr><td>${w.org_id}</td><td>${fmtUsd(w.balance_cents / 100)}</td><td>${fmtUsd(w.daily_burn_estimate_cents / 100)}</td><td>${w.hard_stopped}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4" style="color:var(--text-dim)">No wallets</td></tr>`;
  } catch (e) {
    console.error(e);
  }
}

async function renderCheckpoints() {
  try {
    const { checkpoints } = await apiFetch("/api/checkpoints");
    document.querySelector("#checkpoints-table tbody").innerHTML = checkpoints.length
      ? checkpoints
          .map(
            (c) =>
              `<tr><td>${c.checkpoint}</td><td>${c.status}</td><td>${c.evidence || "—"}</td><td>${new Date(c.updated_at).toLocaleString()}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4" style="color:var(--text-dim)">No checkpoints</td></tr>`;
  } catch (e) {
    console.error(e);
  }
}

function sourceBadge(source) {
  const cls = source === "FIXTURE" ? "badge-fixture" : source === "MIXED" ? "badge-projected" : "badge-real";
  return `<span class="badge ${cls}">${source}</span>`;
}

async function renderRecon() {
  try {
    const [{ summary }, { exceptions }] = await Promise.all([
      apiFetch("/api/recon/summary"),
      apiFetch("/api/recon/exceptions"),
    ]);
    document.querySelector("#recon-summary-table tbody").innerHTML = summary.length
      ? summary
          .map(
            (r) =>
              `<tr><td>${r.entity_code}</td><td>${r.period}</td><td>${r.bank_rows}</td><td>${r.matched}</td>` +
              `<td>${r.matched_pct === null ? "—" : r.matched_pct + "%"}</td><td>${r.exceptions_open}</td>` +
              `<td>${fmtUsd(r.ledger_balance_cents === null ? null : r.ledger_balance_cents / 100)}</td>` +
              `<td>${fmtUsd(r.bank_balance_cents === null ? null : r.bank_balance_cents / 100)}</td>` +
              `<td>${fmtUsd(r.variance_cents / 100)}</td><td>${sourceBadge(r.data_source)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="10" style="color:var(--text-dim)">No reconciliation periods yet</td></tr>`;

    document.querySelector("#recon-exceptions-table tbody").innerHTML = exceptions.length
      ? exceptions
          .map(
            (e) =>
              `<tr><td>${e.entity_code || "—"}</td><td>${e.txn_date || "—"}</td><td>${e.reason}</td><td>${e.status}</td>` +
              `<td>${fmtUsd(e.amount_cents / 100)}</td><td>${e.description || "—"}</td><td>${sourceBadge(e.data_source)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="7" style="color:var(--text-dim)">No open exceptions</td></tr>`;
  } catch (e) {
    console.error(e);
  }
}

async function renderStripe() {
  try {
    const status = await apiFetch("/api/integrations/stripe/status");
    document.getElementById("stripe-status").innerHTML =
      `<div class="label">Connected</div><div class="value">${status.connected ? "Yes" : "No"}</div>` +
      `<p style="color:var(--text-dim);font-size:13px;margin-top:8px">${status.reason}</p>`;
  } catch (e) {
    console.error(e);
  }
}

async function renderAll() {
  document.getElementById("last-updated").textContent = "loading…";
  await Promise.all([
    renderHealth(),
    renderKpis(),
    renderRunway(),
    renderFraud(),
    renderLedgers(),
    renderBillable(),
    renderCheckpoints(),
    renderStripe(),
    renderRecon(),
  ]);
  document.getElementById("last-updated").textContent = "updated " + new Date().toLocaleTimeString();
}

document.getElementById("gate-submit").addEventListener("click", async () => {
  const key = document.getElementById("gate-key").value.trim();
  if (!key) return;
  sessionStorage.setItem(KEY_STORAGE, key);
  showApp();
  renderAll();
});
document.getElementById("gate-key").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("gate-submit").click();
});

if (getKey()) {
  showApp();
  renderAll();
} else {
  showGate();
}

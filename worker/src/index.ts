// Worker entry point. Routes /api/* to the singleton CfoAgent Durable Object instance
// ("ariel-cfo" — single-tenant, per issue #19646 item 6) and serves the static dashboard
// (public/) for everything else. The static app shell (HTML/CSS/JS, no data) is public;
// every /api/* request (all live financial data) must pass the shared-secret gate in
// auth.ts — entered once via the in-page gate form and kept in sessionStorage client-side.

import { getAgentByName } from "agents";
import { CfoAgent } from "./agent";
import { isAuthorized } from "./auth";
import type { Env } from "./lib/env";

export { CfoAgent };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (!isAuthorized(request, env.CFO_AGENT_SHARED_SECRET)) {
        return json(
          { error: "unauthorized", hint: "Pass the shared secret as header 'X-CFO-Secret'." },
          401,
        );
      }
      if (url.pathname === "/api/chat" && request.method === "POST") {
        return handleChat(request, env);
      }
      return handleApi(url, env);
    }

    // Static app shell — no live data, safe to serve unauthenticated. All data lives
    // behind /api/* which the client gates with the in-page shared-secret form.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function handleApi(url: URL, env: Env): Promise<Response> {
  const agent = await getAgentByName<Env, CfoAgent>(env.CFO_AGENT, "ariel-cfo");
  const refresh = url.searchParams.get("refresh") === "1";

  try {
    switch (url.pathname) {
      case "/api/kpis":
        return json(await agent.getKpis(refresh));
      case "/api/anomalies":
        return json(await agent.getAnomalies(refresh));
      case "/api/fraud-alerts":
        return json(await agent.getFraudAlerts(refresh));
      case "/api/customers":
        return json(await agent.getCustomers(refresh));
      case "/api/runway":
        return json(await agent.getRunway(refresh));
      case "/api/health-score":
        return json(await agent.getHealthScore(refresh));
      case "/api/cash-flow-forecast":
        return json(await agent.getCashFlowForecast());
      case "/api/checkpoints":
        return json(await agent.getCheckpoints());
      case "/api/ledgers":
        return json(await agent.getLedgers());
      case "/api/billable-ff":
        return json(await agent.getBillableFF());
      case "/api/integrations/stripe/status":
        return json(await agent.getStripeStatus());
      case "/api/recon/summary":
        return json(await agent.getReconSummary());
      case "/api/recon/exceptions":
        return json(await agent.getReconExceptions());
      case "/api/recurring-costs":
        return json(await agent.getRecurringCosts());
      case "/api/commingled-costs":
        return json(await agent.getCommingledCosts());
      case "/api/close/latest":
        return json(await agent.getCloseLatest());
      case "/api/close/history": {
        const limit = Number(url.searchParams.get("limit") ?? "30");
        return json(await agent.getCloseHistory(Number.isFinite(limit) && limit > 0 ? limit : 30));
      }
      case "/api/tax/package": {
        const year = Number(url.searchParams.get("year") ?? "2026");
        return json(await agent.getTaxPackage(Number.isFinite(year) && year > 2000 ? year : 2026));
      }
      case "/api/viz/cash":
        return json(
          await agent.getVizCash(
            url.searchParams.get("entity"),
            url.searchParams.get("grain"),
            url.searchParams.get("from"),
            url.searchParams.get("to"),
          ),
        );
      case "/api/viz/cashflow":
        return json(
          await agent.getVizCashflow(
            url.searchParams.get("entity"),
            url.searchParams.get("grain"),
            url.searchParams.get("from"),
            url.searchParams.get("to"),
          ),
        );
      case "/api/viz/burn":
        return json(await agent.getVizBurn(url.searchParams.get("entity")));
      case "/api/viz/categories":
        return json(
          await agent.getVizCategories(
            url.searchParams.get("entity"),
            url.searchParams.get("from"),
            url.searchParams.get("to"),
            url.searchParams.get("period"),
          ),
        );
      case "/api/viz/recurring":
        return json(await agent.getVizRecurring(url.searchParams.get("entity")));
      case "/api/viz/commingled":
        return json(await agent.getVizCommingled(url.searchParams.get("entity")));
      case "/api/viz/exceptions":
        return json(await agent.getVizExceptions(url.searchParams.get("entity")));
      default:
        return json({ error: "not_found", path: url.pathname }, 404);
    }
  } catch (err) {
    return json({ error: "internal_error", message: (err as Error).message }, 500);
  }
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  let body: { question?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request", message: "Body must be JSON: {question: string}" }, 400);
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 500) {
    return json({ error: "bad_request", message: "question must be a non-empty string, max 500 chars" }, 400);
  }
  const agent = await getAgentByName<Env, CfoAgent>(env.CFO_AGENT, "ariel-cfo");
  try {
    return json(await agent.postChat(question));
  } catch (err) {
    return json({ error: "internal_error", message: (err as Error).message }, 500);
  }
}

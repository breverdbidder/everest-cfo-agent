// Worker entry point. Routes /api/* to the singleton CfoAgent Durable Object instance
// ("ariel-cfo" — single-tenant, per issue #19646 item 6) and serves the static dashboard
// (public/) for everything else. The static app shell (HTML/CSS/JS, no data) is public;
// every /api/* request (all live financial data) must pass the shared-secret gate in
// auth.ts — entered once via the in-page gate form and kept in sessionStorage client-side.

import { getAgentByName } from "agents";
import { extractText, getDocumentProxy } from "unpdf";
import { CfoAgent } from "./agent";
import { isAuthorized } from "./auth";
import type { Env } from "./lib/env";
import { extractInvoice } from "./lib/invoiceExtract";

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
      const invoiceResponse = await handleInvoiceRoutes(request, url, env);
      if (invoiceResponse) return invoiceResponse;
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

// ---------------------------------------------------------------------------------------------
// Issue #19810 CFO v1 Issue M -- invoice audit routes. Handled separately from handleApi()'s
// plain GET switch because ingest/verify/dispute need the request body and/or a path segment
// (invoice id), neither of which handleApi's (url, env) signature carries. Returns null for any
// path this module doesn't own, so the caller falls through to handleApi() (which 404s
// GET /api/invoices/* itself if this function didn't already handle it -- it always does).
// ---------------------------------------------------------------------------------------------

const INVOICE_ID_ACTION_RE = /^\/api\/invoices\/([0-9a-f-]{36})\/(verify|dispute)$/;

async function extractRequestText(request: Request): Promise<{ text: string; sourceFile: string | null }> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file") as File | string | null;
    if (file && typeof file !== "string") {
      if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
        const buf = new Uint8Array(await file.arrayBuffer());
        const pdf = await getDocumentProxy(buf);
        const { text } = await extractText(pdf, { mergePages: true });
        return { text, sourceFile: file.name };
      }
      return { text: await file.text(), sourceFile: file.name };
    }
    const pastedText = form.get("text");
    if (typeof pastedText === "string" && pastedText.trim()) {
      return { text: pastedText, sourceFile: null };
    }
    throw new Error("multipart body must include a 'file' field or a 'text' field");
  }

  if (contentType.includes("application/pdf")) {
    const buf = new Uint8Array(await request.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    return { text, sourceFile: "upload.pdf" };
  }

  if (contentType.includes("application/json")) {
    const body = await request.json<{ text?: string; source_file?: string }>().catch(() => ({}) as { text?: string; source_file?: string });
    if (!body.text || !body.text.trim()) throw new Error("JSON body must include non-empty 'text'");
    return { text: body.text, sourceFile: body.source_file ?? null };
  }

  const text = await request.text();
  if (!text.trim()) throw new Error("empty request body");
  return { text, sourceFile: null };
}

async function handleInvoiceRoutes(request: Request, url: URL, env: Env): Promise<Response | null> {
  const agent = await getAgentByName<Env, CfoAgent>(env.CFO_AGENT, "ariel-cfo");
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });

  if (url.pathname === "/api/invoices" && request.method === "GET") {
    try {
      return json(await agent.listInvoices());
    } catch (err) {
      return json({ error: "internal_error", message: (err as Error).message }, 500);
    }
  }

  if (url.pathname === "/api/invoices/ingest" && request.method === "POST") {
    let text: string;
    let sourceFile: string | null;
    try {
      ({ text, sourceFile } = await extractRequestText(request));
    } catch (err) {
      return json({ error: "bad_request", message: (err as Error).message }, 400);
    }
    const entityCode = url.searchParams.get("entity_code");
    try {
      const { extracted, method } = await extractInvoice(text, env.DEEPSEEK_API_KEY);
      return json(
        await agent.ingestInvoice(extracted, {
          entityCode: entityCode || null,
          sourceFile,
          rawText: text,
          extractionMethod: method,
        }),
      );
    } catch (err) {
      return json({ error: "extraction_or_ingest_failed", message: (err as Error).message }, 422);
    }
  }

  const idMatch = url.pathname.match(/^\/api\/invoices\/([0-9a-f-]{36})$/);
  if (idMatch && request.method === "GET") {
    try {
      return json(await agent.getInvoiceDetail(idMatch[1]));
    } catch (err) {
      return json({ error: "internal_error", message: (err as Error).message }, 500);
    }
  }

  const actionMatch = url.pathname.match(INVOICE_ID_ACTION_RE);
  if (actionMatch && request.method === "POST") {
    const [, invoiceId, action] = actionMatch;
    try {
      if (action === "verify") {
        return json(await agent.verifyInvoice(invoiceId));
      }
      const body = await request.json<{ goodwill_reason?: string }>().catch(() => ({}) as { goodwill_reason?: string });
      return json(await agent.draftInvoiceDispute(invoiceId, body.goodwill_reason ?? null));
    } catch (err) {
      return json({ error: "internal_error", message: (err as Error).message }, 500);
    }
  }

  return null;
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

// Usage-verification adapter registry (issue #19810 scope item 3). Each adapter pulls ACTUAL
// usage from a vendor API and compares it to the billed line -- this is the part that makes
// invoice audit real rather than an LLM guess. If no adapter is registered for a vendor, or the
// adapter's required credential is missing, the result is verdict='UNVERIFIABLE -- credential
// missing: <name>' with verified_qty=null. Never fabricated. New vendors are additive: push a
// new object onto VENDOR_ADAPTERS, nothing else changes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getVendorCredential } from "./vendorInvoices";
import type { VendorInvoiceLineRow, VendorInvoiceRow } from "./vendorInvoices";

export interface LineVerification {
  verified_qty: number | null;
  variance_pct: number | null;
  verdict: string;
  evidence: Record<string, unknown>;
}

export interface VendorAdapter {
  name: string;
  matchesVendor(vendor: string): boolean;
  /** Verify one billed line. Must never throw for a missing-credential case -- return an
   * UNVERIFIABLE LineVerification instead, naming the exact credential. Throwing is reserved
   * for genuine adapter bugs. */
  verifyLine(client: SupabaseClient, invoice: VendorInvoiceRow, line: VendorInvoiceLineRow): Promise<LineVerification>;
}

function unverifiable(credentialName: string, note?: string): LineVerification {
  return {
    verified_qty: null,
    variance_pct: null,
    verdict: `UNVERIFIABLE — credential missing: ${credentialName}`,
    evidence: { reason: "credential_missing", credential_name: credentialName, note: note ?? null },
  };
}

// ---------------------------------------------------------------------------------------------
// Vercel -- GET /v6/deployments?projectId&since&until, sum buildDuration across every project
// under the team, compare to the billed "Build CPU Minutes" line. This is the trigger-case
// adapter (issue's own worked example: Vercel invoice D2LOTNWY-0007).
//
// UNTESTED against a real response this session: the only Vercel credential reachable from
// this stack (Supabase vault `vercel_api_token` -- confirmed to exist, value never read this
// session per CREDENTIAL HANDLING) is scoped to team_hnNsngSBFPRmWAzVPkxTCMgu
// (everestcapital8@gmail.com, Hobby plan) per the issue's own account-gap note -- a DIFFERENT
// Vercel account than the one that issued this invoice (brevardbidderai@gmail.com, Pro plan).
// The credential this adapter actually needs, `vercel_api_token_brevardbidderai`, does not
// exist yet (confirmed: `select count(*) from vault.secrets where
// name='vercel_api_token_brevardbidderai'` = 0, live query this session). So the HTTP call
// shape below (endpoint, field names: `buildingAt`/`ready` for build-duration, `uid`/`state`
// for pagination) is written from Vercel's documented v6 deployments API but has not been
// exercised against a live response by this session -- flagged rather than silently claimed
// VERIFIED.
// ---------------------------------------------------------------------------------------------

const VERCEL_CREDENTIAL_NAME = "vercel_api_token_brevardbidderai";

interface VercelDeployment {
  uid: string;
  name: string;
  createdAt?: number;
  buildingAt?: number;
  ready?: number;
  state?: string;
}

interface VercelDeploymentsResponse {
  deployments: VercelDeployment[];
  pagination?: { next?: number | null };
}

async function fetchAllVercelDeployments(token: string, sinceMs: number, untilMs: number): Promise<VercelDeployment[]> {
  const all: VercelDeployment[] = [];
  let until = untilMs;
  for (let page = 0; page < 20; page++) {
    const url = new URL("https://api.vercel.com/v6/deployments");
    url.searchParams.set("since", String(sinceMs));
    url.searchParams.set("until", String(until));
    url.searchParams.set("limit", "100");
    const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error(`Vercel /v6/deployments ${resp.status}: ${await resp.text()}`);
    const body = (await resp.json()) as VercelDeploymentsResponse;
    all.push(...(body.deployments ?? []));
    const next = body.pagination?.next;
    if (!next || body.deployments.length === 0) break;
    until = next;
  }
  return all;
}

const vercelAdapter: VendorAdapter = {
  name: "vercel",
  matchesVendor: (vendor) => vendor.toLowerCase().includes("vercel"),
  async verifyLine(client, invoice, line) {
    const token = await getVendorCredential(client, VERCEL_CREDENTIAL_NAME);
    if (!token) return unverifiable(VERCEL_CREDENTIAL_NAME, "Pro-plan brevardbidderai@gmail.com account token not yet supplied by Ariel");

    if (!line.metric_name || !line.metric_name.includes("build")) {
      return unverifiable(VERCEL_CREDENTIAL_NAME, "adapter currently only verifies the Build CPU Minutes line");
    }

    const sinceMs = Date.parse(`${invoice.issued_on}T00:00:00Z`) - 30 * 86_400_000;
    const untilMs = Date.parse(`${invoice.issued_on}T23:59:59Z`);
    try {
      const deployments = await fetchAllVercelDeployments(token, sinceMs, untilMs);
      let totalBuildMs = 0;
      let countedDeployments = 0;
      for (const d of deployments) {
        if (d.buildingAt != null && d.ready != null && d.ready > d.buildingAt) {
          totalBuildMs += d.ready - d.buildingAt;
          countedDeployments += 1;
        }
      }
      const verifiedBuildMinutes = totalBuildMs / 60_000;
      const billedQty = line.qty ?? 0;
      const variancePct = billedQty > 0 ? ((billedQty - verifiedBuildMinutes) / billedQty) * 100 : null;
      return {
        verified_qty: Math.round(verifiedBuildMinutes * 100) / 100,
        variance_pct: variancePct !== null ? Math.round(variancePct * 100) / 100 : null,
        verdict: variancePct !== null && Math.abs(variancePct) <= 10 ? "MATCHES" : "VARIANCE_OVER_THRESHOLD",
        evidence: {
          source: "vercel_v6_deployments_api",
          deployments_counted: countedDeployments,
          total_deployments_returned: deployments.length,
          window: { since: new Date(sinceMs).toISOString(), until: new Date(untilMs).toISOString() },
          billed_qty: billedQty,
          verified_build_minutes: verifiedBuildMinutes,
        },
      };
    } catch (err) {
      return {
        verified_qty: null,
        variance_pct: null,
        verdict: "UNVERIFIABLE — API call failed",
        evidence: { reason: "api_error", message: String((err as Error).message ?? err) },
      };
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Stub adapters -- registered so the registry is honest about which vendors it "knows about"
// (issue: "Adapter registry so new vendors are additive"), but each is currently credential-
// gated to UNVERIFIABLE because no vault entry + allow-list line exists for it yet. Wiring one
// of these for real is: (1) Ariel supplies the credential, (2) add its name to the allow-list
// in public.cfo_invoice_get_vendor_credential (new migration), (3) replace the stub body with
// a real fetch(), same shape as vercelAdapter above.
// ---------------------------------------------------------------------------------------------

function stubAdapter(name: string, vendorMatch: (v: string) => boolean, credentialName: string): VendorAdapter {
  return {
    name,
    matchesVendor: vendorMatch,
    async verifyLine() {
      return unverifiable(credentialName, `${name} adapter registered but not yet wired to a live credential`);
    },
  };
}

const VENDOR_ADAPTERS: VendorAdapter[] = [
  vercelAdapter,
  stubAdapter("supabase", (v) => v.toLowerCase().includes("supabase"), "supabase_management_api_token"),
  stubAdapter("cloudflare", (v) => v.toLowerCase().includes("cloudflare"), "cloudflare_api_token"),
  stubAdapter("anthropic", (v) => v.toLowerCase().includes("anthropic") || v.toLowerCase().includes("claude"), "anthropic_api_key"),
  stubAdapter("openai", (v) => v.toLowerCase().includes("openai"), "openai_api_key"),
  stubAdapter("deepseek", (v) => v.toLowerCase().includes("deepseek"), "DEEPSEEK_API_KEY (Workers secret, not vault)"),
];

export function findAdapter(vendor: string): VendorAdapter | null {
  return VENDOR_ADAPTERS.find((a) => a.matchesVendor(vendor)) ?? null;
}

export async function verifyInvoiceLines(
  client: SupabaseClient,
  invoice: VendorInvoiceRow,
  lines: VendorInvoiceLineRow[],
): Promise<Array<{ line: VendorInvoiceLineRow; result: LineVerification }>> {
  const adapter = findAdapter(invoice.vendor);
  const results: Array<{ line: VendorInvoiceLineRow; result: LineVerification }> = [];
  for (const line of lines) {
    const result = adapter
      ? await adapter.verifyLine(client, invoice, line)
      : unverifiable("no_adapter_registered", `no verification adapter registered for vendor "${invoice.vendor}"`);
    results.push({ line, result });
  }
  return results;
}

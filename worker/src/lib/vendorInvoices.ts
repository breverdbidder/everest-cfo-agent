// Data layer for finance.vendor_invoices / finance.vendor_invoice_lines (issue #19810, CFO v1
// Issue M). Reads go direct via cfo_agent_ro's RLS SELECT grant (same pattern as
// listRecurringCosts/listReconExceptions in ./supabase.ts). Writes go through the
// public.cfo_invoice_* SECURITY DEFINER RPCs from
// supabase/migrations/20260903j_cfo_invoice_audit_19810.sql (cli-anything-biddeed repo) --
// this Worker holds only a cfo_agent_ro-scoped JWT, never service_role, so it cannot INSERT/
// UPDATE finance.* directly (no schema USAGE either -- same constraint documented in
// worker/docs/PORTING_NOTES.md).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface VendorInvoiceRow {
  id: string;
  vendor: string;
  invoice_number: string;
  issued_on: string;
  due_on: string | null;
  currency: string;
  subtotal_cents: number | null;
  total_cents: number;
  entity_code: string | null;
  status: "received" | "verified" | "disputed" | "paid" | "credited";
  source_file: string | null;
  extraction_method: string | null;
  bank_transaction_id: string | null;
  dispute_draft: string | null;
  dispute_draft_at: string | null;
  dispute_reply: string | null;
  dispute_reply_at: string | null;
  created_at: string;
}

export interface VendorInvoiceLineRow {
  id: string;
  invoice_id: string;
  description: string;
  qty: number | null;
  unit_price_cents: number | null;
  amount_cents: number;
  period_start: string | null;
  period_end: string | null;
  metric_name: string | null;
  verified_qty: number | null;
  variance_pct: number | null;
  verdict: string | null;
  evidence: Record<string, unknown> | null;
}

export interface ExtractedInvoiceLine {
  description: string;
  qty: number | null;
  unit_price_cents: number | null;
  amount_cents: number;
  period_start: string | null;
  period_end: string | null;
  metric_name: string | null;
}

export interface ExtractedInvoice {
  vendor: string;
  invoice_number: string;
  issued_on: string;
  due_on: string | null;
  currency: string;
  subtotal_cents: number | null;
  total_cents: number;
  lines: ExtractedInvoiceLine[];
}

export async function listInvoices(client: SupabaseClient, limit = 100): Promise<VendorInvoiceRow[]> {
  const { data, error } = await client
    .schema("finance")
    .from("vendor_invoices")
    .select("*")
    .order("issued_on", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`vendor_invoices list failed: ${error.message}`);
  return data ?? [];
}

export async function getInvoice(
  client: SupabaseClient,
  invoiceId: string,
): Promise<{ invoice: VendorInvoiceRow; lines: VendorInvoiceLineRow[] } | null> {
  const [{ data: invoice, error: invErr }, { data: lines, error: lineErr }] = await Promise.all([
    client.schema("finance").from("vendor_invoices").select("*").eq("id", invoiceId).maybeSingle(),
    client.schema("finance").from("vendor_invoice_lines").select("*").eq("invoice_id", invoiceId).order("created_at", { ascending: true }),
  ]);
  if (invErr) throw new Error(`vendor_invoices get failed: ${invErr.message}`);
  if (lineErr) throw new Error(`vendor_invoice_lines get failed: ${lineErr.message}`);
  if (!invoice) return null;
  return { invoice: invoice as VendorInvoiceRow, lines: (lines ?? []) as VendorInvoiceLineRow[] };
}

export interface IngestResult {
  invoice_id: string;
  created: boolean;
  lines_inserted: number;
  bank_transaction_id: string | null;
}

export async function ingestInvoice(
  client: SupabaseClient,
  extracted: ExtractedInvoice,
  params: { entityCode: string | null; sourceFile: string | null; rawText: string; extractionMethod: string },
): Promise<IngestResult> {
  const { data, error } = await client.rpc("cfo_invoice_ingest", {
    p_vendor: extracted.vendor,
    p_invoice_number: extracted.invoice_number,
    p_issued_on: extracted.issued_on,
    p_due_on: extracted.due_on,
    p_currency: extracted.currency || "USD",
    p_subtotal_cents: extracted.subtotal_cents,
    p_total_cents: extracted.total_cents,
    p_entity_code: params.entityCode,
    p_source_file: params.sourceFile,
    p_raw_text: params.rawText,
    p_extraction_method: params.extractionMethod,
    p_lines: extracted.lines,
  });
  if (error) throw new Error(`cfo_invoice_ingest failed: ${error.message}`);
  return data as IngestResult;
}

export async function writeLineVerification(
  client: SupabaseClient,
  params: { lineId: string; verifiedQty: number | null; variancePct: number | null; verdict: string; evidence: Record<string, unknown> },
): Promise<void> {
  const { error } = await client.rpc("cfo_invoice_write_verification", {
    p_line_id: params.lineId,
    p_verified_qty: params.verifiedQty,
    p_variance_pct: params.variancePct,
    p_verdict: params.verdict,
    p_evidence: params.evidence,
  });
  if (error) throw new Error(`cfo_invoice_write_verification failed: ${error.message}`);
}

export async function setInvoiceStatus(client: SupabaseClient, invoiceId: string, status: VendorInvoiceRow["status"]): Promise<void> {
  const { error } = await client.rpc("cfo_invoice_set_status", { p_invoice_id: invoiceId, p_status: status });
  if (error) throw new Error(`cfo_invoice_set_status failed: ${error.message}`);
}

export async function saveDisputeDraft(client: SupabaseClient, invoiceId: string, draftText: string): Promise<void> {
  const { error } = await client.rpc("cfo_invoice_save_dispute", { p_invoice_id: invoiceId, p_draft_text: draftText });
  if (error) throw new Error(`cfo_invoice_save_dispute failed: ${error.message}`);
}

export interface AnomalyFinding {
  rule: string;
  line_id?: string;
  reason: string;
}

export async function checkAnomalies(client: SupabaseClient, invoiceId: string): Promise<{ findings: AnomalyFinding[]; findings_count: number }> {
  const { data, error } = await client.rpc("cfo_invoice_check_anomalies", { p_invoice_id: invoiceId });
  if (error) throw new Error(`cfo_invoice_check_anomalies failed: ${error.message}`);
  return data as { findings: AnomalyFinding[]; findings_count: number };
}

/** Gated vault read (issue #19810 scope item 3): only names allow-listed in the SQL function
 * are ever returned -- see public.cfo_invoice_get_vendor_credential in the migration. Returns
 * null (never throws) when the credential does not exist, so callers can produce an honest
 * UNVERIFIABLE verdict instead of a 500. */
export async function getVendorCredential(client: SupabaseClient, name: string): Promise<string | null> {
  const { data, error } = await client.rpc("cfo_invoice_get_vendor_credential", { p_name: name });
  if (error) throw new Error(`cfo_invoice_get_vendor_credential failed: ${error.message}`);
  return (data as string | null) ?? null;
}

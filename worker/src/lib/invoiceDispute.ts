// Dispute/credit-request letter drafting (issue #19810 scope item 5). Tier 1 propose-only --
// this module only ever returns text; nothing in this Worker sends it anywhere (POST
// /api/invoices/:id/dispute in index.ts stores the draft via
// public.cfo_invoice_save_dispute and returns it in the response body -- no Resend call is
// wired here, matching the issue's non-goal "No auto-sending any dispute or email to a
// vendor").
//
// Same DeepSeek-primary / deterministic-fallback split as ./invoiceExtract.ts, for the same
// reason (DEEPSEEK_API_KEY not provisioned on this Worker this session).

import type { VendorInvoiceLineRow, VendorInvoiceRow } from "./vendorInvoices";

export interface DisputeLineContext {
  line: VendorInvoiceLineRow;
  finding: string | null; // anomaly reason text, if this line triggered one
}

const SYSTEM_PROMPT = `You are drafting a vendor billing dispute / goodwill-credit request letter on behalf of a small company's finance team. Rules:
- Ground every claim in the billed vs verified numbers given to you. Never invent a number.
- If the verified quantity is UNVERIFIABLE (no usage data available), do NOT claim the vendor's meter is wrong -- ask for the underlying usage data instead, or if the cause is already known (e.g. an internal automation bug now fixed), request a goodwill credit citing that cause rather than disputing the meter itself.
- If verified usage genuinely matches or exceeds the billed amount, do not draft a "your meter is wrong" claim -- draft a goodwill-credit request describing the root cause and remediation instead.
- Professional, concise business letter. No internal tool names, ticket numbers, or repo names -- describe the cause in plain business terms (e.g. "an automation misconfiguration in our deployment pipeline, since corrected").
- State: the specific line item, the amount, the period, and the exact remedy requested.
Output the letter body only (no subject line, no signature block placeholder needed beyond "Sincerely,").`;

function fmtUsd(cents: number | null): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

/** Deterministic fallback template -- used whenever DEEPSEEK_API_KEY is absent. Every number
 * in the output is read directly from the invoice/line rows or the anomaly finding text passed
 * in; nothing is invented. */
export function draftDisputeFallback(invoice: VendorInvoiceRow, lines: DisputeLineContext[], goodwillReason: string | null): string {
  const flaggedLines = lines.filter((l) => l.finding || l.line.verdict?.startsWith("UNVERIFIABLE") || l.line.verdict === "VARIANCE_OVER_THRESHOLD");
  const target = flaggedLines[0] ?? lines[0];

  const lineDetail = target
    ? `- Line item: "${target.line.description}" — billed ${target.line.qty ?? "n/a"} units for ${fmtUsd(target.line.amount_cents)}` +
      (target.line.verified_qty !== null && target.line.verified_qty !== undefined
        ? `, our own usage records show ${target.line.verified_qty} units (variance ${target.line.variance_pct}%).`
        : `. We were unable to independently verify this quantity against our own usage records for this billing period.`)
    : "";

  const causeParagraph = goodwillReason
    ? `The elevated usage on this invoice traces to ${goodwillReason} We identified and corrected this on our side; going forward this metric should return to its normal run-rate.`
    : `We are requesting the supporting usage detail for the line item above so we can reconcile it against our own records.`;

  const remedy = goodwillReason
    ? `Given the cause was on our side and has already been remediated, we are requesting this as a one-time goodwill credit rather than disputing the accuracy of your metering.`
    : `We are requesting either the underlying per-deployment usage detail for this line, or, if that data confirms the billed quantity, an explanation of what drove the increase relative to our typical usage.`;

  return `To the Billing Team,

We are writing regarding invoice ${invoice.invoice_number}, issued ${invoice.issued_on}, total ${fmtUsd(invoice.total_cents)}.

${lineDetail}

${causeParagraph}

${remedy}

Please let us know what additional information you need from our side to process this request.

Sincerely,
Everest Capital USA / BidDeed.AI — Finance`;
}

export async function draftDisputeWithDeepSeek(
  invoice: VendorInvoiceRow,
  lines: DisputeLineContext[],
  goodwillReason: string | null,
  deepseekApiKey: string,
): Promise<string> {
  const context = {
    vendor: invoice.vendor,
    invoice_number: invoice.invoice_number,
    issued_on: invoice.issued_on,
    total_cents: invoice.total_cents,
    lines: lines.map((l) => ({
      description: l.line.description,
      billed_qty: l.line.qty,
      billed_amount_cents: l.line.amount_cents,
      verified_qty: l.line.verified_qty,
      variance_pct: l.line.variance_pct,
      verdict: l.line.verdict,
      anomaly_finding: l.finding,
    })),
    known_root_cause: goodwillReason,
  };

  const resp = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepseekApiKey}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(context, null, 2) },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`DeepSeek dispute draft failed: ${resp.status} ${await resp.text()}`);
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("DeepSeek returned no dispute draft content");
  return text;
}

export async function draftDispute(
  invoice: VendorInvoiceRow,
  lines: DisputeLineContext[],
  goodwillReason: string | null,
  deepseekApiKey: string | undefined,
): Promise<{ text: string; method: "deepseek" | "fallback_template" }> {
  if (deepseekApiKey) {
    return { text: await draftDisputeWithDeepSeek(invoice, lines, goodwillReason, deepseekApiKey), method: "deepseek" };
  }
  return { text: draftDisputeFallback(invoice, lines, goodwillReason), method: "fallback_template" };
}

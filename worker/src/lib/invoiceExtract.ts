// Invoice text -> structured {vendor, invoice_number, dates, lines[]} extraction (issue #19810
// scope item 2). Primary path is DeepSeek V3.2 (house LLM policy -- "no Anthropic key in the
// Worker", same sanctioned pattern as ./health-score.ts's getReasoning()). DEEPSEEK_API_KEY is
// NOT currently provisioned as a secret on this Worker (confirmed via `gh secret list` this
// session -- absent, same open gap as #19764 Finding/Open-item 1, which only affected chat
// reasoning text there; here it blocks the actual extraction). Per CC_META_PROMPT #7 + this
// repo's Tier-1 gate on "new vendor/API credentials," provisioning it onto a repo not named in
// this issue is not this session's call to make silently -- flagged in the report, not routed
// around.
//
// So this module has two paths, both real (neither fabricates a line item that isn't in the
// source text):
//   1. extractWithDeepSeek() -- the spec'd path, used whenever DEEPSEEK_API_KEY is configured.
//   2. extractWithFallbackParser() -- a deterministic regex parser for the common
//      "description (qty)   $amount" tabular shape (the exact shape of the trigger-case Vercel
//      invoice, and common to most usage-based SaaS invoices/receipts). Used only when
//      DEEPSEEK_API_KEY is absent, so the feature isn't 100% hard-blocked by the credential
//      gap. `extraction_method` on the stored invoice always records which path actually ran
//      ("deepseek" | "fallback_regex") -- never silently mislabeled.

import type { ExtractedInvoice, ExtractedInvoiceLine } from "./vendorInvoices";

const SYSTEM_PROMPT = `You are an invoice-parsing engine. Given raw invoice text (may include markdown formatting, tables, or PDF-extracted text with irregular spacing), extract EXACTLY the data present in the text. Never invent a vendor name, invoice number, date, or line item that is not in the source text -- if a field is not present, use null. Output ONLY valid JSON matching this schema:
{
  "vendor": string,
  "invoice_number": string,
  "issued_on": "YYYY-MM-DD",
  "due_on": "YYYY-MM-DD" | null,
  "currency": string (ISO 4217, default "USD"),
  "subtotal_cents": integer | null,
  "total_cents": integer,
  "lines": [
    {
      "description": string,
      "qty": number | null,
      "unit_price_cents": integer | null,
      "amount_cents": integer,
      "period_start": "YYYY-MM-DD" | null,
      "period_end": "YYYY-MM-DD" | null,
      "metric_name": string | null (a short snake_case slug of the description, e.g. "build_cpu_minutes")
    }
  ]
}
All *_cents fields are integers (dollars * 100). Extract every line item present -- do not summarize or omit any.`;

export async function extractWithDeepSeek(rawText: string, deepseekApiKey: string): Promise<ExtractedInvoice> {
  const resp = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepseekApiKey}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: rawText },
      ],
    }),
  });
  if (!resp.ok) {
    throw new Error(`DeepSeek extraction failed: ${resp.status} ${await resp.text()}`);
  }
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned no content");
  const parsed = JSON.parse(content) as ExtractedInvoice;
  validateExtracted(parsed);
  return parsed;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toCents(dollarStr: string): number {
  return Math.round(Number.parseFloat(dollarStr.replace(/,/g, "")) * 100);
}

/** Deterministic fallback for "description (qty)   $amount" tabular invoice bodies, plus a
 * labeled header line (`<Vendor> invoice <NUMBER>, issued <DATE>, $<TOTAL>`). Matches the
 * trigger-case Vercel invoice text verbatim. Never guesses a value it can't find in the text --
 * missing fields are left null, and the function throws (422, not a fabricated invoice) if it
 * cannot find a vendor, invoice number, issued date, and total. */
export function extractWithFallbackParser(rawText: string): ExtractedInvoice {
  const vendorMatch = rawText.match(/([A-Z][A-Za-z0-9.]+(?:\s[A-Z][A-Za-z0-9.]+)?)\s+invoice\s+\**([A-Za-z0-9-]+)\**/);
  const issuedMatch = rawText.match(/issued\s+(\d{4}-\d{2}-\d{2})/i);
  const totalMatch = rawText.match(/\$\s?([\d,]+\.\d{2})/); // first $amount in the header is the total

  if (!vendorMatch || !issuedMatch || !totalMatch) {
    throw new Error(
      "fallback_regex parser could not find vendor+invoice_number, issued date, and total in the text -- refusing to fabricate an invoice record",
    );
  }

  const vendor = vendorMatch[1].trim();
  const invoiceNumber = vendorMatch[2].trim();
  const issuedOn = issuedMatch[1];
  const totalCents = toCents(totalMatch[1]);

  const lines: ExtractedInvoiceLine[] = [];
  const lineRe = /^(.+?)\s*\(([^)]+)\)\s+\$\s?([\d,]+\.\d{2})/;
  for (const rawLine of rawText.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(lineRe);
    if (!m) continue;
    const description = m[1].trim();
    const qtyRaw = m[2].trim();
    const amountCents = toCents(m[3]);
    const qty = /^[\d,.]+$/.test(qtyRaw) ? Number.parseFloat(qtyRaw.replace(/,/g, "")) : null;
    lines.push({
      description,
      qty,
      unit_price_cents: qty && qty > 0 ? Math.round(amountCents / qty) : null,
      amount_cents: amountCents,
      period_start: null,
      period_end: null,
      metric_name: slugify(description),
    });
  }

  if (lines.length === 0) {
    throw new Error("fallback_regex parser found a header but zero 'description (qty) $amount' lines -- refusing to fabricate line items");
  }

  const subtotalCents = lines.reduce((s, l) => s + l.amount_cents, 0);

  return {
    vendor,
    invoice_number: invoiceNumber,
    issued_on: issuedOn,
    due_on: null,
    currency: "USD",
    subtotal_cents: subtotalCents,
    total_cents: totalCents,
    lines,
  };
}

function validateExtracted(inv: ExtractedInvoice): void {
  if (!inv.vendor || !inv.invoice_number || !inv.issued_on || !Number.isFinite(inv.total_cents)) {
    throw new Error("extraction result missing required fields (vendor/invoice_number/issued_on/total_cents)");
  }
  if (!Array.isArray(inv.lines) || inv.lines.length === 0) {
    throw new Error("extraction result has zero line items");
  }
}

export async function extractInvoice(
  rawText: string,
  deepseekApiKey: string | undefined,
): Promise<{ extracted: ExtractedInvoice; method: "deepseek" | "fallback_regex" }> {
  if (deepseekApiKey) {
    return { extracted: await extractWithDeepSeek(rawText, deepseekApiKey), method: "deepseek" };
  }
  return { extracted: extractWithFallbackParser(rawText), method: "fallback_regex" };
}

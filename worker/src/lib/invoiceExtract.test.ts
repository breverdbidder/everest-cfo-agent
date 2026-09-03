import { describe, expect, it } from "vitest";
import { extractWithFallbackParser } from "./invoiceExtract";

// Exact text from issue #19810's trigger case.
const VERCEL_INVOICE_TEXT = `Vercel invoice **D2LOTNWY-0007**, issued 2026-08-18, **$102.37**, billed to \`brevardbidderai@gmail.com\` ("Ariel Shapira's projects", Pro plan):
Function Invocations (84,940)          $0.03
Build CPU Minutes (29,160)            $82.20   <-- 80% of the invoice
Fluid Active CPU (1)                   $0.08
Fast Origin Transfer (0.37)            $0.01
Fluid Provisioned Memory (9.49)        $0.05
Pro seat (Aug 18 - Sep 17)            $20.00`;

describe("extractWithFallbackParser", () => {
  it("extracts vendor, invoice number, issued date, and total from the header", () => {
    const result = extractWithFallbackParser(VERCEL_INVOICE_TEXT);
    expect(result.vendor).toBe("Vercel");
    expect(result.invoice_number).toBe("D2LOTNWY-0007");
    expect(result.issued_on).toBe("2026-08-18");
    expect(result.total_cents).toBe(10237);
  });

  it("extracts all 6 line items with correct amounts", () => {
    const result = extractWithFallbackParser(VERCEL_INVOICE_TEXT);
    expect(result.lines).toHaveLength(6);
    expect(result.lines.map((l) => l.amount_cents)).toEqual([3, 8220, 8, 1, 5, 2000]);
    expect(result.lines.map((l) => l.description)).toEqual([
      "Function Invocations",
      "Build CPU Minutes",
      "Fluid Active CPU",
      "Fast Origin Transfer",
      "Fluid Provisioned Memory",
      "Pro seat",
    ]);
  });

  it("parses numeric parenthetical as qty, ignores trailing comment text on the Build CPU Minutes line", () => {
    const result = extractWithFallbackParser(VERCEL_INVOICE_TEXT);
    const buildLine = result.lines.find((l) => l.description === "Build CPU Minutes");
    expect(buildLine?.qty).toBe(29160);
    expect(buildLine?.amount_cents).toBe(8220);
    expect(buildLine?.metric_name).toBe("build_cpu_minutes");
  });

  it("leaves qty null for a non-numeric parenthetical (date range) instead of fabricating a number", () => {
    const result = extractWithFallbackParser(VERCEL_INVOICE_TEXT);
    const seatLine = result.lines.find((l) => l.description === "Pro seat");
    expect(seatLine?.qty).toBeNull();
    expect(seatLine?.amount_cents).toBe(2000);
  });

  it("sums line amounts to a subtotal that matches the stated total for this invoice", () => {
    const result = extractWithFallbackParser(VERCEL_INVOICE_TEXT);
    expect(result.subtotal_cents).toBe(10237);
    expect(result.subtotal_cents).toBe(result.total_cents);
  });

  it("throws rather than fabricating a record when the header is unrecognizable", () => {
    expect(() => extractWithFallbackParser("this is not an invoice")).toThrow();
  });

  it("throws rather than fabricating line items when the header parses but no lines match", () => {
    expect(() => extractWithFallbackParser("Acme invoice INV-1, issued 2026-01-01, $10.00, no line items here")).toThrow();
  });
});

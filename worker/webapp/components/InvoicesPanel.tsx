// Issue #19810 CFO v1 Issue M -- "Invoices" dashboard tab. Ingest form, invoice list with
// status badges, per-line billed-vs-verified detail with variance%, anomaly flags, and a
// "Draft dispute" action. Tier 1 propose-only throughout: nothing here ever sends an email --
// draftDispute() only stores + displays the text (see worker/src/index.ts POST
// /api/invoices/:id/dispute -> agent.draftInvoiceDispute(), which calls
// public.cfo_invoice_save_dispute, never Resend).

import React, { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiPostForm, UnauthorizedError } from "../api";
import { fmtDate, fmtUsd } from "../format";
import { ENTITY_CODES, ENTITY_LABELS } from "../types";
import type { AnomalyFinding, VendorInvoiceLineRow, VendorInvoiceRow } from "../types";

interface InvoiceDetail {
  invoice: VendorInvoiceRow | null;
  lines: VendorInvoiceLineRow[];
  anomalies?: { findings: AnomalyFinding[]; findings_count: number };
}

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    received: "badge-fixture",
    verified: "badge-real",
    disputed: "badge-personal",
    paid: "badge-real",
    credited: "badge-projected",
  };
  return <span className={`badge ${cls[status] ?? "badge-fixture"}`}>{status}</span>;
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="badge badge-fixture">not run</span>;
  if (verdict.startsWith("UNVERIFIABLE")) return <span className="badge badge-projected">{verdict}</span>;
  if (verdict === "MATCHES") return <span className="badge badge-real">{verdict}</span>;
  return <span className="badge badge-fixture">{verdict}</span>;
}

export function InvoicesPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [invoices, setInvoices] = useState<VendorInvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [disputeDraft, setDisputeDraft] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const [pasteText, setPasteText] = useState("");
  const [entityCode, setEntityCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiGet<{ invoices: VendorInvoiceRow[] }>("/api/invoices");
      setInvoices(resp.invoices);
    } catch (e) {
      if (e instanceof UnauthorizedError) return onUnauthorized();
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openDetail = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setDetailLoading(true);
      setDisputeDraft(null);
      try {
        const resp = await apiGet<InvoiceDetail>(`/api/invoices/${id}`);
        setDetail(resp);
        if (resp.invoice?.dispute_draft) setDisputeDraft(resp.invoice.dispute_draft);
      } catch (e) {
        if (e instanceof UnauthorizedError) return onUnauthorized();
        setError((e as Error).message);
      } finally {
        setDetailLoading(false);
      }
    },
    [onUnauthorized],
  );

  const runVerify = useCallback(async () => {
    if (!selectedId) return;
    setVerifying(true);
    try {
      const resp = await apiPost<InvoiceDetail>(`/api/invoices/${selectedId}/verify`, {});
      setDetail(resp);
      loadList();
    } catch (e) {
      if (e instanceof UnauthorizedError) return onUnauthorized();
      setError((e as Error).message);
    } finally {
      setVerifying(false);
    }
  }, [selectedId, loadList, onUnauthorized]);

  const runDispute = useCallback(async () => {
    if (!selectedId) return;
    setDrafting(true);
    try {
      const resp = await apiPost<{ draft: string; sent: boolean }>(`/api/invoices/${selectedId}/dispute`, {
        goodwill_reason:
          "an automation misconfiguration in our CI/CD pipeline that produced excess automated deploys, since identified and corrected",
      });
      setDisputeDraft(resp.draft);
    } catch (e) {
      if (e instanceof UnauthorizedError) return onUnauthorized();
      setError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  }, [selectedId, onUnauthorized]);

  const runIngest = useCallback(async () => {
    setIngesting(true);
    setIngestResult(null);
    try {
      let resp: { invoice_id: string; created: boolean; lines_inserted: number };
      const qs = entityCode ? `?entity_code=${encodeURIComponent(entityCode)}` : "";
      if (file) {
        const form = new FormData();
        form.set("file", file);
        resp = await apiPostForm(`/api/invoices/ingest${qs}`, form);
      } else {
        if (!pasteText.trim()) throw new Error("Paste invoice text or choose a file first.");
        const form = new FormData();
        form.set("text", pasteText);
        resp = await apiPostForm(`/api/invoices/ingest${qs}`, form);
      }
      setIngestResult(`Ingested invoice ${resp.invoice_id} (${resp.created ? "new" : "updated"}), ${resp.lines_inserted} lines.`);
      setPasteText("");
      setFile(null);
      loadList();
    } catch (e) {
      if (e instanceof UnauthorizedError) return onUnauthorized();
      setIngestResult(`Ingest failed: ${(e as Error).message}`);
    } finally {
      setIngesting(false);
    }
  }, [pasteText, file, entityCode, loadList, onUnauthorized]);

  return (
    <div className="invoices-panel">
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <section className="chart-card" aria-labelledby="invoice-ingest-heading">
        <div className="chart-card-head">
          <div>
            <h2 id="invoice-ingest-heading">Ingest a vendor invoice</h2>
            <p className="chart-subtitle">Paste invoice text or upload a PDF. Extraction runs via DeepSeek when configured, otherwise a deterministic fallback parser.</p>
          </div>
        </div>
        <div className="invoice-ingest-form">
          <label>
            <span className="control-label">Entity (optional)</span>
            <select value={entityCode} onChange={(e) => setEntityCode(e.target.value)} aria-label="Entity">
              <option value="">— unassigned —</option>
              {ENTITY_CODES.map((c) => (
                <option key={c} value={c}>
                  {ENTITY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="control-label">Paste invoice text</span>
            <textarea rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Vendor invoice text..." aria-label="Invoice text" />
          </label>
          <label>
            <span className="control-label">...or upload a PDF</span>
            <input type="file" accept=".pdf,application/pdf,.txt,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Invoice file" />
          </label>
          <button type="button" onClick={runIngest} disabled={ingesting}>
            {ingesting ? "Ingesting…" : "Ingest invoice"}
          </button>
          {ingestResult && <p className="chart-subtitle">{ingestResult}</p>}
        </div>
      </section>

      <section className="chart-card" aria-labelledby="invoices-list-heading">
        <div className="chart-card-head">
          <div>
            <h2 id="invoices-list-heading">Invoices</h2>
            <p className="chart-subtitle">All ingested vendor invoices, most recent first.</p>
          </div>
        </div>
        {loading ? (
          <div className="skeleton skeleton-table" aria-hidden="true" />
        ) : invoices.length === 0 ? (
          <div className="empty-state">No invoices ingested yet.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Invoice #</th>
                  <th>Issued</th>
                  <th>Total</th>
                  <th>Entity</th>
                  <th>Status</th>
                  <th>Bank match</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.vendor}</td>
                    <td className="mono">{inv.invoice_number}</td>
                    <td>{fmtDate(inv.issued_on)}</td>
                    <td className="mono">{fmtUsd(inv.total_cents, { showCents: true })}</td>
                    <td>{inv.entity_code ?? "—"}</td>
                    <td>
                      <StatusBadge status={inv.status} />
                    </td>
                    <td>{inv.bank_transaction_id ? "matched" : "—"}</td>
                    <td>
                      <button type="button" onClick={() => openDetail(inv.id)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedId && (
        <section className="chart-card" aria-labelledby="invoice-detail-heading">
          <div className="chart-card-head">
            <div>
              <h2 id="invoice-detail-heading">
                {detail?.invoice ? `${detail.invoice.vendor} — ${detail.invoice.invoice_number}` : "Invoice detail"}
              </h2>
              <p className="chart-subtitle">Billed vs verified quantity per line, anomaly flags, and dispute drafting.</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={runVerify} disabled={verifying}>
                {verifying ? "Verifying…" : "Run verification"}
              </button>
              <button type="button" onClick={runDispute} disabled={drafting}>
                {drafting ? "Drafting…" : "Draft dispute / credit request"}
              </button>
            </div>
          </div>

          {detailLoading ? (
            <div className="skeleton skeleton-table" aria-hidden="true" />
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Billed qty</th>
                      <th>Amount</th>
                      <th>Verified qty</th>
                      <th>Variance %</th>
                      <th>Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail?.lines ?? []).map((l) => (
                      <tr key={l.id}>
                        <td>{l.description}</td>
                        <td className="mono">{l.qty ?? "—"}</td>
                        <td className="mono">{fmtUsd(l.amount_cents, { showCents: true })}</td>
                        <td className="mono">{l.verified_qty ?? "—"}</td>
                        <td className="mono">{l.variance_pct ?? "—"}</td>
                        <td>
                          <VerdictBadge verdict={l.verdict} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {detail?.anomalies && detail.anomalies.findings_count > 0 && (
                <div className="invoice-anomalies">
                  <p className="subsection-heading">Anomaly flags ({detail.anomalies.findings_count})</p>
                  <ul>
                    {detail.anomalies.findings.map((f, i) => (
                      <li key={i} className="chart-subtitle">
                        <strong>{f.rule}</strong>: {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {disputeDraft && (
                <div className="invoice-dispute-draft">
                  <p className="subsection-heading">Draft (not sent — propose-only)</p>
                  <pre>{disputeDraft}</pre>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

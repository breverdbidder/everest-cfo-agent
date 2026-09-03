import React, { useMemo, useState } from "react";
import { fmtDate, fmtUsd } from "../format";
import type { ReconExceptionRow } from "../types";

const STATUS_ALL = "all";

export function ExceptionsTable({ rows, loading }: { rows: ReconExceptionRow[]; loading: boolean }) {
  const [status, setStatus] = useState<string>(STATUS_ALL);
  const [reasonFilter, setReasonFilter] = useState<string>("");

  const statuses = useMemo(() => [STATUS_ALL, ...new Set(rows.map((r) => r.status))], [rows]);

  const filtered = rows.filter((r) => {
    if (status !== STATUS_ALL && r.status !== status) return false;
    if (reasonFilter && !r.reason.toLowerCase().includes(reasonFilter.toLowerCase())) return false;
    return true;
  });

  return (
    <section className="chart-card" aria-labelledby="exceptions-heading">
      <div className="chart-card-head">
        <div>
          <h2 id="exceptions-heading">Reconciliation exceptions</h2>
          <p className="chart-subtitle">Bank transactions that didn't auto-match the ledger.</p>
        </div>
      </div>
      <div className="table-filters">
        <label>
          <span className="control-label">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s === STATUS_ALL ? "All statuses" : s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="control-label">Reason contains</span>
          <input type="text" value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} placeholder="e.g. no match" aria-label="Filter by reason" />
        </label>
      </div>
      {loading ? (
        <div className="skeleton skeleton-table" aria-hidden="true" />
      ) : filtered.length === 0 ? (
        <div className="empty-state">{rows.length === 0 ? "No reconciliation exceptions for this entity." : "No exceptions match the current filters."}</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Entity</th>
                <th>Date</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Amount</th>
                <th>Description</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.exception_id}>
                  <td>{r.entity_code ?? "—"}</td>
                  <td>{r.txn_date ? fmtDate(r.txn_date) : "—"}</td>
                  <td>{r.reason}</td>
                  <td>{r.status}</td>
                  <td className="mono">{fmtUsd(r.amount_cents)}</td>
                  <td>{r.description ?? "—"}</td>
                  <td>
                    <span className={`badge ${r.data_source === "REAL" ? "badge-real" : "badge-fixture"}`}>{r.data_source}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

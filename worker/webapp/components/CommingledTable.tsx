import React from "react";
import { fmtDate, fmtUsdDollars } from "../format";
import type { CommingledCostRow } from "../types";

export function CommingledTable({ rows, loading }: { rows: CommingledCostRow[]; loading: boolean }) {
  const total = rows.reduce((s, r) => s + Number(r.amount_dollars || 0), 0);
  return (
    <section className="chart-card" aria-labelledby="commingled-heading">
      <div className="chart-card-head">
        <div>
          <h2 id="commingled-heading">
            Commingled business costs <span className="badge badge-personal">PERSONAL ACCOUNT</span>
          </h2>
          <p className="chart-subtitle">
            Business infra/SaaS paid from ariel_personal. Tier 1 propose-only — Ariel reviews and approves each reclass.
          </p>
        </div>
      </div>
      {loading ? (
        <div className="skeleton skeleton-table" aria-hidden="true" />
      ) : rows.length === 0 ? (
        <div className="empty-state">No commingled business costs detected.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Vendor</th>
                <th>Amount</th>
                <th>Likely entity</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bank_transaction_id}>
                  <td>{fmtDate(r.txn_date)}</td>
                  <td>{r.vendor_description}</td>
                  <td className="mono">{fmtUsdDollars(r.amount_dollars)}</td>
                  <td>{r.likely_business_entity || "unclear — Ariel to assign"}</td>
                  <td>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mono table-total">
            {rows.length} transactions, {fmtUsdDollars(total)} total, all paid from ariel_personal
          </p>
        </div>
      )}
    </section>
  );
}

import React from "react";
import type { CfoDailyCloseRow } from "../types";

const STALE_AFTER_HOURS = 36; // issue #19769: amber threshold, "> 36h old"

/** Issue #19765's finance.cfo_daily_close, surfaced here per that commit's own stated
 * purpose ("so the dashboard (#19764) can show a 'books current as of <timestamp>' badge").
 *
 * Tone per issue #19769's explicit spec: red only when status <> 'VERIFIED' or
 * unbalanced_count > 0, amber only when the last close is stale (>36h), green otherwise.
 * (finance.cfo_daily_close.status is 'VERIFIED' | 'FAILED' -- migration
 * 20260903b_cfo_daily_close_pipeline_19765.sql -- an earlier `status !== "success"` check
 * against that column meant every successful close still rendered red; fixed for #19764,
 * this pass extends it to the full 3-state spec: unbalanced_count now forces red instead of
 * amber, exceptions_open no longer affects tone at all, and the stale threshold moved from
 * 26h to the issue's stated 36h.) */
export function CloseBadge({ latest }: { latest: CfoDailyCloseRow | null }) {
  if (!latest) return null;

  const ageHours = (Date.now() - Date.parse(latest.run_at)) / 3_600_000;
  const notVerified = latest.status !== "VERIFIED";
  const unbalanced = latest.unbalanced_count > 0;
  const failed = notVerified || unbalanced;
  const stale = !failed && ageHours > STALE_AFTER_HOURS;
  const tone = failed ? "critical" : stale ? "warning" : "healthy";

  const label = notVerified
    ? `Daily close failed at ${new Date(latest.run_at).toLocaleString()}`
    : unbalanced
      ? `Books out of balance as of ${new Date(latest.run_at).toLocaleString()} (${latest.unbalanced_count} unbalanced)`
      : stale
        ? `Books last closed ${new Date(latest.run_at).toLocaleString()} (stale)`
        : `Books current as of ${new Date(latest.run_at).toLocaleString()}`;

  return (
    <span className={`badge close-badge status-${tone}`} title={latest.error ?? undefined}>
      {label}
    </span>
  );
}

import React from "react";
import type { CfoDailyCloseRow } from "../types";

const STALE_AFTER_HOURS = 26; // daily_close() runs ~09:00 UTC; 26h gives a 2h grace window

/** Issue #19765's finance.cfo_daily_close, surfaced here per that commit's own stated
 * purpose ("so the dashboard (#19764) can show a 'books current as of <timestamp>' badge"). */
export function CloseBadge({ latest }: { latest: CfoDailyCloseRow | null }) {
  if (!latest) return null;

  const ageHours = (Date.now() - Date.parse(latest.run_at)) / 3_600_000;
  const failed = latest.status !== "success";
  const stale = ageHours > STALE_AFTER_HOURS;
  const hasIssues = latest.exceptions_open > 0 || latest.unbalanced_count > 0;
  const tone = failed || stale ? "critical" : hasIssues ? "warning" : "healthy";

  const label = failed
    ? `Daily close failed at ${new Date(latest.run_at).toLocaleString()}`
    : stale
      ? `Books last closed ${new Date(latest.run_at).toLocaleString()} (stale)`
      : `Books current as of ${new Date(latest.run_at).toLocaleString()}`;

  return (
    <span className={`badge close-badge status-${tone}`} title={latest.error ?? undefined}>
      {label}
    </span>
  );
}

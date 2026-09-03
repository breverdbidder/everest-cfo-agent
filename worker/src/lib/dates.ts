// Date bucketing for the viz endpoints. All dates are plain "YYYY-MM-DD" strings (Postgres
// `date` columns come back that way from PostgREST) and are treated as UTC calendar dates --
// no timezone math, matching how finance.bank_transactions.posted_on is stored.

export type Grain = "day" | "week" | "month";

export function parseGrain(value: string | null): Grain {
  return value === "week" || value === "month" ? value : "day";
}

/** Truncates an ISO date string to the start of its bucket for the given grain. */
export function bucketStart(isoDate: string, grain: Grain): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (grain === "day") return isoDate;
  if (grain === "month") {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  // week: Monday-start ISO week
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Generates every bucket-start date from `from` to `to` (inclusive) at the given grain. */
export function bucketRange(from: string, to: string, grain: Grain): string[] {
  const buckets: string[] = [];
  let cursor = bucketStart(from, grain);
  const end = bucketStart(to, grain);
  const step = grain === "day" ? 1 : grain === "week" ? 7 : null;
  let guard = 0;
  while (cursor <= end && guard < 5000) {
    buckets.push(cursor);
    cursor = step ? addDays(cursor, step) : addMonths(cursor, 1);
    guard++;
  }
  return buckets;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Resolves the `from`/`to`/`preset` query params into a concrete [from, to] date range. */
export function resolveRange(
  fromParam: string | null,
  toParam: string | null,
  presetParam: string | null,
  earliestKnown: string,
): { from: string; to: string } {
  const to = toParam || todayIso();
  if (fromParam) return { from: fromParam, to };

  const preset = presetParam || "90d";
  if (preset === "30d") return { from: addDays(to, -30), to };
  if (preset === "ytd") return { from: `${to.slice(0, 4)}-01-01`, to };
  if (preset === "all") return { from: earliestKnown, to };
  return { from: addDays(to, -90), to }; // default 90d
}

export function fmtUsd(cents: number | null | undefined, { showCents = false } = {}): string {
  if (cents === null || cents === undefined) return "—";
  const dollars = cents / 100;
  const sign = dollars < 0 ? "-" : "";
  return `${sign}$${Math.abs(dollars).toLocaleString(undefined, {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  })}`;
}

export function fmtUsdDollars(dollars: number | null | undefined): string {
  if (dollars === null || dollars === undefined) return "—";
  return fmtUsd(Math.round(dollars * 100));
}

export function fmtMonths(months: number | null): string {
  if (months === null) return "—";
  if (!Number.isFinite(months)) return "∞";
  return `${months.toFixed(1)} mo`;
}

export function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function fmtMonthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { year: "numeric", month: "short", timeZone: "UTC" });
}

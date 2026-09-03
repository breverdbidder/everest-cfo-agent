import type { Preset } from "./types";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Client always sends an explicit from/to so every /api/viz/* endpoint resolves the same
 * range consistently (the backend's own preset handling only applies to /api/viz/categories). */
export function presetToRange(preset: Preset): { from: string; to: string } {
  const to = todayIso();
  if (preset === "30d") return { from: isoDaysAgo(30), to };
  if (preset === "ytd") return { from: `${to.slice(0, 4)}-01-01`, to };
  if (preset === "all") return { from: "2020-01-01", to };
  return { from: isoDaysAgo(90), to };
}

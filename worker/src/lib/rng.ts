// Seeded PRNG for the Monte Carlo simulations ported from analysis.py / cash_flow_forecaster.py.
//
// DEVIATION FROM PYTHON SOURCE (documented per CC_META_PROMPT.md §2.3):
// The Python source seeds `numpy.random.default_rng(42)` (PCG64). Workers has no numpy;
// this uses Mulberry32 (a standard 32-bit seeded PRNG) + Box-Muller for the normal draws.
// Same seed value (42) is used for parity of intent, but output sequences are NOT
// bit-identical to the Python source — only the algorithm/formula (mean, stddev, N draws,
// simulation counts) is preserved faithfully.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SeededRng {
  private next: () => number;
  private spareNormal: number | null = null;

  constructor(seed = 42) {
    this.next = mulberry32(seed);
  }

  uniform(low = 0, high = 1): number {
    return low + this.next() * (high - low);
  }

  normal(mean = 0, stddev = 1): number {
    if (this.spareNormal !== null) {
      const value = this.spareNormal;
      this.spareNormal = null;
      return mean + stddev * value;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    const z0 = mag * Math.cos(2.0 * Math.PI * v);
    const z1 = mag * Math.sin(2.0 * Math.PI * v);
    this.spareNormal = z1;
    return mean + stddev * z0;
  }
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function quantile(values: number[], q: number): number {
  return percentile(values, q * 100);
}

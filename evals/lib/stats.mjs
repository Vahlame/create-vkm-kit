#!/usr/bin/env node
/**
 * Shared statistics for the live-LLM benches (ADR-0064).
 *
 * `METHODOLOGY.md` §5 already prescribes replicas, spread, confidence intervals and
 * effect sizes. What was missing was anything to compute them with — so `RESULTS.md`
 * files ended up reporting **bold** deltas off n=1–2 with spreads like [50,100],
 * which is exactly what the same document warns against. This module closes that gap
 * and makes the reporting rule executable instead of aspirational.
 *
 * The rule, applied by `classify()`:
 *
 *   n < MIN_N              → `directional` — reportable, never bold, never a decision
 *   n ≥ MIN_N, CI excludes 0 (and |Δ| > epsilon when one is pre-registered)
 *                          → `significant` — bold, may drive a decision
 *   n ≥ MIN_N, CI includes 0 → `inconclusive` — a real answer, reported as such
 *
 * Small-n by construction: bench cells cost live model calls, so n is 5–10, not 500.
 * That drives two choices. The bootstrap is **seeded and deterministic** (same input,
 * same interval, forever) because a CI that changes between runs cannot gate anything.
 * And the effect size is **Cliff's delta** — non-parametric, ordinal, no normality
 * assumption — with Hedges' g offered alongside for readers who want the parametric
 * number. Bench scores are bounded 0–100 and often bimodal (a task passes or it
 * doesn't); Cohen's d on n=5 of that shape is a number that looks more authoritative
 * than it is.
 *
 * Zero deps, no I/O — importable from any `run.mjs` and from a test.
 */

/** Minimum replicas per cell before a delta may be reported as a finding. */
export const MIN_N = 5;

/** Default bootstrap resamples. 10k is stable to ~0.1 on these cell sizes. */
export const DEFAULT_ITERS = 10_000;

/**
 * Deterministic PRNG (mulberry32). Seeded on purpose: `Math.random()` would make
 * every reported interval unreproducible, and an unreproducible number cannot be
 * checked by a reviewer or pinned by a test.
 * @param {number} seed
 * @returns {() => number} uniform in [0, 1)
 */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {number[]} xs */
export function mean(xs) {
  if (!xs.length) return NaN;
  return xs.reduce((a, x) => a + x, 0) / xs.length;
}

/**
 * The min/max a cell actually produced. Kept because it is what a reader needs to
 * see to distrust a mean: `[50, 100]` says "two runs disagreed completely" in a way
 * no summary statistic does.
 * @param {number[]} xs
 * @returns {[number, number]}
 */
export function spread(xs) {
  return [Math.min(...xs), Math.max(...xs)];
}

/** Sample standard deviation (n−1). @param {number[]} xs */
export function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Percentile bootstrap CI of a statistic over one sample.
 * @param {number[]} xs
 * @param {{ iters?: number, alpha?: number, seed?: number, stat?: (s: number[]) => number }} [opts]
 * @returns {{ lo: number, hi: number }}
 */
export function bootstrapCI(
  xs,
  { iters = DEFAULT_ITERS, alpha = 0.05, seed = 1, stat = mean } = {}
) {
  if (xs.length < 2) return { lo: NaN, hi: NaN };
  const next = rng(seed);
  const stats = new Array(iters);
  const resample = new Array(xs.length);
  for (let i = 0; i < iters; i++) {
    for (let j = 0; j < xs.length; j++) resample[j] = xs[(next() * xs.length) | 0];
    stats[i] = stat(resample);
  }
  stats.sort((p, q) => p - q);
  return {
    lo: stats[Math.floor((alpha / 2) * iters)],
    hi: stats[Math.min(iters - 1, Math.floor((1 - alpha / 2) * iters))]
  };
}

/**
 * Percentile bootstrap CI of the DIFFERENCE of means (a − b), resampling each arm
 * independently — the two arms are separate runs, not paired observations.
 * @param {number[]} a
 * @param {number[]} b
 * @param {{ iters?: number, alpha?: number, seed?: number }} [opts]
 * @returns {{ lo: number, hi: number }}
 */
export function bootstrapDeltaCI(a, b, { iters = DEFAULT_ITERS, alpha = 0.05, seed = 1 } = {}) {
  if (a.length < 2 || b.length < 2) return { lo: NaN, hi: NaN };
  const next = rng(seed);
  const stats = new Array(iters);
  const ra = new Array(a.length);
  const rb = new Array(b.length);
  for (let i = 0; i < iters; i++) {
    for (let j = 0; j < a.length; j++) ra[j] = a[(next() * a.length) | 0];
    for (let j = 0; j < b.length; j++) rb[j] = b[(next() * b.length) | 0];
    stats[i] = mean(ra) - mean(rb);
  }
  stats.sort((p, q) => p - q);
  return {
    lo: stats[Math.floor((alpha / 2) * iters)],
    hi: stats[Math.min(iters - 1, Math.floor((1 - alpha / 2) * iters))]
  };
}

/**
 * Cliff's delta: P(a > b) − P(a < b), in [−1, 1]. Non-parametric and ordinal, so a
 * bounded bimodal score scale doesn't break it.
 * @param {number[]} a
 * @param {number[]} b
 */
export function cliffsDelta(a, b) {
  if (!a.length || !b.length) return NaN;
  let gt = 0;
  let lt = 0;
  for (const x of a) {
    for (const y of b) {
      if (x > y) gt++;
      else if (x < y) lt++;
    }
  }
  return (gt - lt) / (a.length * b.length);
}

/**
 * Romano et al.'s conventional magnitude bands for Cliff's delta.
 * @param {number} d
 * @returns {"negligible"|"small"|"medium"|"large"}
 */
export function cliffsMagnitude(d) {
  const abs = Math.abs(d);
  if (abs < 0.147) return "negligible";
  if (abs < 0.33) return "small";
  if (abs < 0.474) return "medium";
  return "large";
}

/**
 * Hedges' g — Cohen's d with the small-sample bias correction. Offered for readers
 * who expect the parametric number; `classify()` does not decide on it.
 * @param {number[]} a
 * @param {number[]} b
 */
export function hedgesG(a, b) {
  const na = a.length;
  const nb = b.length;
  if (na < 2 || nb < 2) return NaN;
  const pooled = Math.sqrt(((na - 1) * stdev(a) ** 2 + (nb - 1) * stdev(b) ** 2) / (na + nb - 2));
  if (pooled === 0) return mean(a) === mean(b) ? 0 : Infinity;
  const d = (mean(a) - mean(b)) / pooled;
  const df = na + nb - 2;
  return d * (1 - 3 / (4 * df - 1)); // bias correction
}

/**
 * @typedef {object} Verdict
 * @property {number} n            replicas in the smaller arm — the one that limits the claim
 * @property {number} delta        mean(a) − mean(b)
 * @property {{lo: number, hi: number}} ci   bootstrap CI of the delta
 * @property {number} cliffs
 * @property {ReturnType<typeof cliffsMagnitude>} magnitude
 * @property {number} hedges
 * @property {"significant"|"directional"|"inconclusive"} label
 * @property {boolean} bold        may this number be bolded in RESULTS.md?
 * @property {string} reason       one line, printable next to the number
 */

/**
 * Apply the reporting rule to one A/B cell.
 *
 * `epsilon` is a pre-registered indifference margin: with it, a CI that excludes 0
 * but sits inside ±epsilon is `inconclusive`, not `significant`. That is how a
 * "must be no worse than" gate (WP1's `B ≥ A − ε`) gets decided by the same code
 * that decides "is better than", instead of by eyeballing.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @param {{ minN?: number, epsilon?: number, seed?: number, alpha?: number }} [opts]
 * @returns {Verdict}
 */
export function classify(a, b, { minN = MIN_N, epsilon = 0, seed = 1, alpha = 0.05 } = {}) {
  const n = Math.min(a.length, b.length);
  const delta = mean(a) - mean(b);
  const ci = bootstrapDeltaCI(a, b, { seed, alpha });
  const cliffs = cliffsDelta(a, b);
  const base = {
    n,
    delta,
    ci,
    cliffs,
    magnitude: cliffsMagnitude(cliffs),
    hedges: hedgesG(a, b)
  };
  if (n < minN) {
    return {
      ...base,
      label: "directional",
      bold: false,
      reason: `n=${n} < ${minN} — directional only, not a decision`
    };
  }
  const excludesZero = ci.lo > 0 || ci.hi < 0;
  const clearsEpsilon = Math.abs(delta) > epsilon;
  if (excludesZero && clearsEpsilon) {
    return {
      ...base,
      label: "significant",
      bold: true,
      reason:
        `n=${n}, 95% CI [${ci.lo.toFixed(1)}, ${ci.hi.toFixed(1)}] excludes 0` +
        (epsilon ? `, |Δ| > ε=${epsilon}` : "")
    };
  }
  return {
    ...base,
    label: "inconclusive",
    bold: false,
    reason: excludesZero
      ? `n=${n}, CI excludes 0 but |Δ|=${Math.abs(delta).toFixed(1)} ≤ ε=${epsilon}`
      : `n=${n}, 95% CI [${ci.lo.toFixed(1)}, ${ci.hi.toFixed(1)}] includes 0`
  };
}

/**
 * Render one cell the way `RESULTS.md` should print it: bold **only** when the
 * verdict earned it. Keeping the formatting here is the point — a bold delta
 * becomes impossible to write by hand without going through the rule.
 * @param {Verdict} v
 */
export function formatDelta(v) {
  const sign = v.delta > 0 ? "+" : "";
  const num = `${sign}${v.delta.toFixed(1)}`;
  if (v.bold) return `**${num}** (${v.reason})`;
  if (v.label === "directional") return `${num} _(directional, n=${v.n})_`;
  return `${num} _(inconclusive)_`;
}

/**
 * Per-cell summary line: mean, spread and n, in the order a reader needs them.
 * @param {number[]} xs
 */
export function formatCell(xs) {
  if (!xs.length) return "—";
  const [lo, hi] = spread(xs);
  return `${mean(xs).toFixed(1)} [${lo}, ${hi}] n=${xs.length}`;
}

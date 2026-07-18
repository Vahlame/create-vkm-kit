#!/usr/bin/env node
// Type-scale and spacing-rhythm checker — zero dependencies, Node >= 18.
// Library:   import { checkTypeScale, checkSpacing, generateScale } from "./scale.mjs"
// CLI:       node scale.mjs --type 12,16,20,25 [--ratio 1.25] [--base 16] [--tolerance 0.03]
//            node scale.mjs --space 4,8,12,24 [--base 4]
//            node scale.mjs --gen 16,1.25,6        (emit a scale: base, ratio, steps)
//            node scale.mjs --gen --base 16 --ratio 1.25 --steps 6      (same, named flags)
// Exit codes: 0 = coherent/generated · 1 = off-scale values found · 2 = usage error.
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Classic modular-scale ratios. All are valid as an explicit `ratio`. */
export const CANDIDATE_RATIOS = [1.067, 1.125, 1.2, 1.25, 1.333, 1.414, 1.5, 1.618];
/**
 * Ratios eligible for INFERENCE (no `ratio` given). 1.067 is excluded: its steps sit only
 * 6.7% apart, so the default ±3% tolerance bands cover ~91% of the value space and almost
 * any incoherent set "fits" — observed on a real file where 22 ad-hoc font sizes scored
 * 1 offender under 1.067, a false PASS that buried exactly the incoherence this check
 * exists to expose. An explicit `--ratio 1.067` still checks against it.
 */
const INFERABLE_RATIOS = CANDIDATE_RATIOS.filter((r) => r !== 1.067);

function assertPositiveNumbers(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new RangeError(`${label}: need a non-empty array of numbers`);
  }
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      throw new RangeError(`${label}: "${v}" is not a positive number`);
    }
  }
}

/**
 * Check sizes against a modular scale: every size must be base * ratio^k (integer k)
 * within a relative tolerance. When `ratio` is omitted, the best-fitting candidate is
 * inferred from `INFERABLE_RATIOS` (1.067 must be requested explicitly — see above).
 * @param {number[]} sizes
 * @param {{ ratio?: number, base?: number, tolerance?: number }} [opts]
 * @returns {{ ratio: number, base: number, inferred: boolean, offenders: {value: number, nearest: number}[] }}
 */
export function checkTypeScale(sizes, { ratio, base, tolerance = 0.03 } = {}) {
  assertPositiveNumbers(sizes, "type sizes");
  if (!(tolerance > 0 && tolerance < 0.5)) throw new RangeError("tolerance must be in (0, 0.5)");
  const b = base ?? Math.min(...sizes);
  if (!(b > 0)) throw new RangeError("base must be positive");

  const fitFor = (r) => {
    const offenders = [];
    let errSum = 0;
    for (const v of sizes) {
      const k = Math.round(Math.log(v / b) / Math.log(r));
      const nearest = b * r ** k;
      const err = Math.abs(v - nearest) / nearest;
      errSum += err;
      if (err > tolerance) offenders.push({ value: v, nearest: Number(nearest.toFixed(2)) });
    }
    return { offenders, meanErr: errSum / sizes.length };
  };

  if (ratio !== undefined) {
    if (!(ratio > 1)) throw new RangeError("ratio must be > 1");
    return { ratio, base: b, inferred: false, offenders: fitFor(ratio).offenders };
  }
  // Fewest offenders wins; ties (common at loose tolerances) break on mean relative error.
  let best = null;
  for (const r of INFERABLE_RATIOS) {
    const fit = fitFor(r);
    if (
      !best ||
      fit.offenders.length < best.fit.offenders.length ||
      (fit.offenders.length === best.fit.offenders.length && fit.meanErr < best.fit.meanErr)
    ) {
      best = { ratio: r, fit };
    }
  }
  return { ratio: best.ratio, base: b, inferred: true, offenders: best.fit.offenders };
}

/**
 * Check spacing values against a base-unit rhythm: every value must be an integer
 * multiple of `base` (floating error tolerated at 1e-9).
 *
 * When offenders exist and `base` is halvable (even, half ≥ 2), a `halfGrid` diagnosis is
 * attached IF the half-grid explains part of the mess (strictly fewer offenders): real
 * files often interleave 4k and 4k+2 values — a deliberate 2px half-step rhythm. Without
 * the diagnosis such a file reads as "8 values off-rhythm" and costs a manual detour to
 * conclude "false alarm" (real session, 2026-07-18); with it, the CLI can say "all but 3
 * sit on the 2px half-grid" directly. The check still FAILS against the declared base —
 * the diagnosis informs the judgment, it doesn't soften the exit code.
 * @param {number[]} values
 * @param {{ base?: number }} [opts]
 * @returns {{ base: number, offenders: number[], halfGrid?: { base: number, offenders: number[] } }}
 */
export function checkSpacing(values, { base = 4 } = {}) {
  assertPositiveNumbers(values, "spacing values");
  if (!(base > 0)) throw new RangeError("base must be positive");
  const offAgainst = (b) => values.filter((v) => Math.abs(v / b - Math.round(v / b)) > 1e-9);
  const offenders = offAgainst(base);
  const result = { base, offenders };
  const half = base / 2;
  if (offenders.length && Number.isInteger(half) && half >= 2) {
    const halfOffenders = offAgainst(half);
    if (halfOffenders.length < offenders.length) {
      result.halfGrid = { base: half, offenders: halfOffenders };
    }
  }
  return result;
}

/**
 * Generate a modular scale upward from a base.
 * @param {number} base
 * @param {number} ratio > 1
 * @param {number} steps integer 1–20 (sizes beyond the base)
 * @returns {number[]} base plus `steps` derived sizes, 2-decimal rounded
 */
export function generateScale(base, ratio, steps) {
  if (!(base > 0)) throw new RangeError("base must be positive");
  if (!(ratio > 1)) throw new RangeError("ratio must be > 1");
  if (!Number.isInteger(steps) || steps < 1 || steps > 20) {
    throw new RangeError("steps must be an integer 1–20");
  }
  return Array.from({ length: steps + 1 }, (_, k) => Number((base * ratio ** k).toFixed(2)));
}

function parseList(s, label) {
  const nums = String(s)
    .split(",")
    .map((x) => Number(x.trim()));
  if (nums.some((n) => !Number.isFinite(n))) {
    throw new RangeError(`${label}: "${s}" is not a comma-separated number list`);
  }
  return nums;
}

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

function usageError(msg) {
  console.error(`error: ${msg}`);
  console.error(
    "usage: node scale.mjs --type 12,16,20,25 [--ratio 1.25] [--base 16] [--tolerance 0.03] | " +
      "--space 4,8,12 [--base 4] | --gen 16,1.25,6 | --gen --base 16 --ratio 1.25 --steps 6"
  );
  process.exit(2);
}

function main(argv) {
  const args = argv.slice(2);
  const typeArg = flagValue(args, "--type");
  const spaceArg = flagValue(args, "--space");
  // --gen takes the packed form (--gen 16,1.25,6) OR named flags
  // (--gen --base 16 --ratio 1.25 --steps 6). The packed-only version swallowed a following
  // `--base` as its value and died with a misleading "not a comma-separated number list".
  if (args.includes("--gen")) {
    try {
      const packed = args[args.indexOf("--gen") + 1];
      let base, ratio, steps;
      if (packed !== undefined && !packed.startsWith("--")) {
        [base, ratio, steps] = parseList(packed, "--gen");
      } else {
        const named = (flag) => {
          const v = flagValue(args, flag);
          if (v === undefined || v.startsWith("--") || !Number.isFinite(Number(v))) {
            throw new RangeError(`--gen (flag form) needs ${flag} <number>`);
          }
          return Number(v);
        };
        base = named("--base");
        ratio = named("--ratio");
        steps = named("--steps");
      }
      console.log(generateScale(base, ratio, Math.trunc(steps ?? NaN)).join(", "));
      process.exit(0);
    } catch (e) {
      return usageError(e.message);
    }
  }
  if (!typeArg && !spaceArg) return usageError("need --type, --space or --gen");
  let failed = false;
  try {
    if (typeArg) {
      const ratio = flagValue(args, "--ratio");
      const base = flagValue(args, "--base");
      const tolerance = flagValue(args, "--tolerance");
      const res = checkTypeScale(parseList(typeArg, "--type"), {
        ratio: ratio === undefined ? undefined : Number(ratio),
        base: base === undefined ? undefined : Number(base),
        tolerance: tolerance === undefined ? undefined : Number(tolerance)
      });
      const src = res.inferred ? "inferred" : "given";
      if (res.offenders.length) {
        failed = true;
        console.log(`TYPE  FAIL  ratio ${res.ratio} (${src}), base ${res.base}`);
        for (const o of res.offenders) {
          console.log(`  off-scale: ${o.value} (nearest step ${o.nearest})`);
        }
        if (res.inferred) {
          console.log("  (1.067 excluded from inference — pass --ratio 1.067 if deliberate)");
        }
      } else {
        console.log(`TYPE  PASS  ratio ${res.ratio} (${src}), base ${res.base}`);
      }
    }
    if (spaceArg) {
      const base = flagValue(args, "--base");
      const res = checkSpacing(parseList(spaceArg, "--space"), {
        base: base === undefined ? undefined : Number(base)
      });
      if (res.offenders.length) {
        failed = true;
        console.log(`SPACE FAIL  base ${res.base} — not multiples: ${res.offenders.join(", ")}`);
        if (res.halfGrid) {
          console.log(
            res.halfGrid.offenders.length === 0
              ? `  (half-grid ${res.halfGrid.base}px: ALL values align — a half-step rhythm or phase mix; judge intent before renumbering)`
              : `  (half-grid ${res.halfGrid.base}px: only ${res.halfGrid.offenders.join(", ")} stay off — the rest is a half-step rhythm; judge intent before renumbering)`
          );
        }
      } else {
        console.log(`SPACE PASS  base ${res.base}`);
      }
    }
  } catch (e) {
    return usageError(e.message);
  }
  process.exit(failed ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv);

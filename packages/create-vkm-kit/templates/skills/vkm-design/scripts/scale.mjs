#!/usr/bin/env node
// Type-scale and spacing-rhythm checker — zero dependencies, Node >= 18.
// Library:   import { checkTypeScale, checkSpacing, generateScale } from "./scale.mjs"
// CLI:       node scale.mjs --type 12,16,20,25 [--ratio 1.25] [--base 16] [--tolerance 0.03]
//            node scale.mjs --space 4,8,12,24 [--base 4]
//            node scale.mjs --gen 16,1.25,6        (emit a scale: base, ratio, steps)
// Exit codes: 0 = coherent/generated · 1 = off-scale values found · 2 = usage error.
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Classic modular-scale ratios, used when --ratio is not given. */
export const CANDIDATE_RATIOS = [1.067, 1.125, 1.2, 1.25, 1.333, 1.414, 1.5, 1.618];

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
 * within a relative tolerance. When `ratio` is omitted, the best-fitting candidate is inferred.
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
  for (const r of CANDIDATE_RATIOS) {
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
 * @param {number[]} values
 * @param {{ base?: number }} [opts]
 * @returns {{ base: number, offenders: number[] }}
 */
export function checkSpacing(values, { base = 4 } = {}) {
  assertPositiveNumbers(values, "spacing values");
  if (!(base > 0)) throw new RangeError("base must be positive");
  const offenders = values.filter((v) => Math.abs(v / base - Math.round(v / base)) > 1e-9);
  return { base, offenders };
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
    "usage: node scale.mjs --type 12,16,20,25 [--ratio 1.25] [--base 16] [--tolerance 0.03] | --space 4,8,12 [--base 4]"
  );
  process.exit(2);
}

function main(argv) {
  const args = argv.slice(2);
  const typeArg = flagValue(args, "--type");
  const spaceArg = flagValue(args, "--space");
  const genArg = flagValue(args, "--gen");
  if (genArg) {
    try {
      const [base, ratio, steps] = parseList(genArg, "--gen");
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

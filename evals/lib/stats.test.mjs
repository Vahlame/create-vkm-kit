/**
 * Tests for the shared bench statistics (ADR-0064).
 *
 * Two things matter here beyond "the math is right":
 *
 *  1. **Determinism.** A confidence interval that moves between runs cannot gate a
 *     decision or be checked by a reviewer. The bootstrap is seeded; this pins it.
 *  2. **The reporting rule is enforced by code, not by discipline.** The n<5 →
 *     `directional` demotion and the `bold` flag are asserted, so a bold delta off
 *     n=2 becomes impossible to produce through this module — which is the entire
 *     point of centralising it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_N,
  rng,
  mean,
  spread,
  stdev,
  bootstrapCI,
  bootstrapDeltaCI,
  cliffsDelta,
  cliffsMagnitude,
  hedgesG,
  classify,
  formatDelta,
  formatCell
} from "./stats.mjs";

test("descriptives", () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.deepEqual(spread([50, 100, 75]), [50, 100]);
  assert.equal(stdev([2, 2, 2]), 0);
  assert.ok(Math.abs(stdev([1, 2, 3, 4]) - 1.2909944) < 1e-6);
  assert.ok(Number.isNaN(mean([])));
  assert.equal(stdev([5]), 0, "a single observation has no sample stdev, not NaN");
});

test("rng is deterministic and uniform-ish", () => {
  const a = Array.from({ length: 5 }, rng(42));
  const b = Array.from({ length: 5 }, rng(42));
  assert.deepEqual(a, b, "same seed must replay exactly");
  assert.notDeepEqual(a, Array.from({ length: 5 }, rng(43)));
  assert.ok(a.every((x) => x >= 0 && x < 1));
});

test("cliffsDelta: textbook boundary cases", () => {
  assert.equal(cliffsDelta([10, 11, 12], [1, 2, 3]), 1, "fully dominant → +1");
  assert.equal(cliffsDelta([1, 2, 3], [10, 11, 12]), -1, "fully dominated → −1");
  assert.equal(cliffsDelta([1, 2, 3], [1, 2, 3]), 0, "identical → 0");
  // pairs (3,2) (3,0) (1,0) greater, (1,2) less → (3−1)/4
  assert.equal(cliffsDelta([3, 1], [2, 0]), 0.5);
});

test("cliffsMagnitude uses the conventional bands", () => {
  assert.equal(cliffsMagnitude(0.1), "negligible");
  assert.equal(cliffsMagnitude(0.2), "small");
  assert.equal(cliffsMagnitude(0.4), "medium");
  assert.equal(cliffsMagnitude(-0.9), "large", "magnitude is direction-agnostic");
});

test("hedgesG: zero difference, and the small-sample correction shrinks d", () => {
  assert.equal(hedgesG([1, 2, 3], [1, 2, 3]), 0);
  const a = [10, 12, 11, 13, 12];
  const b = [4, 5, 6, 5, 4];
  const g = hedgesG(a, b);
  const pooled = Math.sqrt((4 * stdev(a) ** 2 + 4 * stdev(b) ** 2) / 8);
  const d = (mean(a) - mean(b)) / pooled;
  assert.ok(Math.abs(g) < Math.abs(d), "Hedges' g must be strictly smaller than Cohen's d");
});

test("bootstrap intervals are deterministic and bracket the point estimate", () => {
  const xs = [70, 75, 80, 85, 90];
  const first = bootstrapCI(xs, { iters: 2000, seed: 7 });
  const again = bootstrapCI(xs, { iters: 2000, seed: 7 });
  assert.deepEqual(first, again, "same seed must reproduce the interval exactly");
  assert.ok(first.lo <= mean(xs) && mean(xs) <= first.hi);
  assert.ok(Number.isNaN(bootstrapCI([42]).lo), "n=1 has no interval");
});

test("bootstrapDeltaCI separates clearly-different arms and overlaps identical ones", () => {
  const far = bootstrapDeltaCI([90, 92, 94, 91, 93], [10, 12, 14, 11, 13], {
    iters: 2000,
    seed: 3
  });
  assert.ok(far.lo > 0, "a large real difference must produce an interval above 0");

  const same = bootstrapDeltaCI([50, 55, 45, 52, 48], [51, 54, 46, 53, 47], {
    iters: 2000,
    seed: 3
  });
  assert.ok(same.lo < 0 && same.hi > 0, "indistinguishable arms must straddle 0");
});

test("classify: n below the floor is directional and never bold", () => {
  // Deltas this large would be "obviously significant" by eye — that is exactly the
  // failure mode being prevented. Two runs cannot carry a finding.
  const v = classify([100, 100], [0, 0]);
  assert.equal(v.n, 2);
  assert.equal(v.label, "directional");
  assert.equal(v.bold, false);
  assert.match(v.reason, /n=2 < 5/);
  assert.match(formatDelta(v), /_\(directional, n=2\)_/);
  assert.doesNotMatch(formatDelta(v), /\*\*/, "a directional delta must never render bold");
});

test("classify: enough replicas and a separated interval earns bold", () => {
  const v = classify([95, 97, 96, 98, 94], [60, 62, 58, 61, 59]);
  assert.ok(v.n >= MIN_N);
  assert.equal(v.label, "significant");
  assert.equal(v.bold, true);
  assert.equal(v.magnitude, "large");
  assert.match(formatDelta(v), /^\*\*\+/);
});

test("classify: enough replicas but an interval spanning zero is inconclusive", () => {
  const v = classify([50, 55, 45, 52, 48], [51, 54, 46, 53, 47]);
  assert.equal(v.label, "inconclusive");
  assert.equal(v.bold, false);
  assert.match(v.reason, /includes 0/);
});

test("classify: a pre-registered epsilon turns a tiny real difference into a non-finding", () => {
  // The WP1 shape: the fixed layer must be no worse than stock by more than ε. A
  // consistent −1 point is real but inside the indifference margin, so it must not
  // read as a regression.
  const a = [79, 79, 79, 79, 79];
  const b = [80, 80, 80, 80, 80];
  const strict = classify(a, b, { epsilon: 0 });
  assert.equal(strict.label, "significant", "with no margin, a consistent gap is a finding");
  const withMargin = classify(a, b, { epsilon: 2 });
  assert.equal(withMargin.label, "inconclusive");
  assert.equal(withMargin.bold, false);
  assert.match(withMargin.reason, /ε=2/);
});

test("classify reports the SMALLER arm's n — the one that limits the claim", () => {
  assert.equal(classify([1, 2, 3, 4, 5, 6, 7, 8], [1, 2]).n, 2);
});

test("formatCell prints mean, spread and n together", () => {
  assert.equal(formatCell([50, 100]), "75.0 [50, 100] n=2");
  assert.equal(formatCell([]), "—");
});

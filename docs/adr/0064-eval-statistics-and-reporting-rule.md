# ADR-0064: Shared eval statistics and an executable reporting rule

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** maintainer

## Context

`evals/discipline-bench/METHODOLOGY.md` §5 has prescribed replicas, spread,
confidence intervals and effect sizes since it was written. Nothing in the repo
computed any of them. The predictable result: every `RESULTS.md` reports **bold**
deltas — the visual grammar of a finding — off n=1 to n=3, with per-cell spreads
like `[50, 100]` and `[90, 50]` that the surrounding prose then apologises for.

Counted across the benches: **18 bold deltas, all at n ≤ 3, none at n ≥ 5.**

This is not a small inconsistency between a document and a practice. The kit's whole
argument for existing is that it measures its own claims instead of asserting them;
a bold number off two runs is the same failure the kit diagnoses elsewhere, committed
in the repo that diagnoses it. And it matters operationally right now: the work
queued behind this ADR turns bench output into _decisions_ (whether the fixed layer is
harmless, whether a hook stays on by default). A decision rule applied by eye, to
numbers whose noise band is ±7–13, is not a decision rule.

One bench already did it right — `token-quality-ab` pre-registers its decision rule in
`README.md` and reports the verdict against it. That is the pattern to generalise, and
it exists, so this is not an invention.

## Decision

Ship `evals/lib/stats.mjs`, shared by every bench runner, and make the reporting rule
something code applies rather than something authors remember:

| n     | interval                                  | label          | bold? |
| ----- | ----------------------------------------- | -------------- | ----- |
| `< 5` | —                                         | `directional`  | no    |
| `≥ 5` | excludes 0, and clears a pre-registered ε | `significant`  | yes   |
| `≥ 5` | includes 0 (or within ε)                  | `inconclusive` | no    |

`classify()` returns the verdict; `formatDelta()` renders it and emits bold **only**
when the verdict earned it. `epsilon` is a pre-registered indifference margin, so a
"must be no worse than" gate is decided by the same code as "is better than".

Two deliberate choices behind the numbers:

- **The bootstrap is seeded and deterministic.** An interval that changes between runs
  cannot gate anything and cannot be checked by a reviewer.
- **The headline effect size is Cliff's delta**, not Cohen's d. Bench scores are
  bounded 0–100 and frequently bimodal (a hidden test passes or it doesn't); a
  parametric d over n=5 of that shape reads more authoritative than it is. Hedges' g
  is computed alongside for readers who want it, but `classify()` does not decide on it.

`evals/` is not an npm workspace, so `npm test --workspaces` never ran anything in it.
CI now runs `node --test evals/lib/` — the code every bench number is derived from gets
the same gate as shipped code.

Finally, a correction pass: every pre-existing `RESULTS.md` gets a banner stating the
rule and its deltas re-labelled `directional`. **No measurement was changed** — only
the weight placed on it.

**Which edge of the control loop this closes:** ⑦ LEARN, partially. The loop cannot
feed anything back from evidence that has no error bars. This does not close ⑦ on its
own; it makes closing it possible.

## Alternatives considered

- **Raise n on the existing benches instead of re-labelling.** Rejected as the first
  move, not as the eventual one: re-running every cell at n ≥ 5 costs live model calls
  and would leave the published numbers overstated until it finished. Re-labelling is
  immediate, honest, and does not block the re-runs.
- **Delete the under-powered rounds.** Rejected. They are real evidence of the right
  direction; the defect is the weight, not the data. Deleting them would also destroy
  the record of how the instruments evolved.
- **A statistics dependency (simple-statistics, jStat).** Rejected by the kit's own
  ladder: the four functions needed are ~15 lines each, and the seeded-RNG requirement
  would have meant wrapping the dependency anyway.
- **Cohen's d as the headline effect size.** Rejected for the score distributions in
  play (see above); kept as a secondary number.
- **A CI gate that fails the build on a non-compliant `RESULTS.md`.** Rejected for now:
  it would need a markdown parser guessing which bold spans are deltas. The rule is
  enforced where the numbers are produced, which is the place that actually decides.

## Consequences

- Positive: bold means one thing across every bench, and it is applied by code. The
  pre-registered-ε shape needed by the off-target control exists before that bench
  does, so its decision rule can be committed before its first run.
- Positive: the shared eval libraries are now under CI at all.
- Negative: the published results read as weaker. That is the correction working —
  they always were that weak.
- Neutral: no bench was re-run and no measurement changed in this ADR.

## References

- `evals/lib/stats.mjs`, `evals/lib/stats.test.mjs`
- `evals/discipline-bench/METHODOLOGY.md` §5 (the rule it always prescribed)
- `evals/token-quality-ab/README.md` (the pre-registration pattern generalised here)
- ADR-0063 (fixed-context inventory — the other half of "measure before deciding")

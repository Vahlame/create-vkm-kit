# Results — design-bench

> **Reporting standard (ADR-0064).** `evals/lib/stats.mjs` fixes the rule
> `METHODOLOGY.md` §5 already prescribed: a delta may be **bold** only at **n ≥ 5**
> with a bootstrap CI excluding 0. Every round below predates that rule and ran at
> n ≤ 3, so its deltas are re-labelled **directional** — reportable, and honest about
> what they are, but never a decision on their own. The numbers are unchanged; only
> the weight put on them is. Re-running these cells at n ≥ 5 is tracked as follow-up
> work, not silently pending.

## 2026-07-21 · AUTO round 1 (mechanical score, multi-model, held-out brief)

First round of the automated harness (`run.mjs`): score 0–100 from the skill's own
validators (slop fingerprint 40 + declared contrast 20 + type scale 20 + spacing
rhythm 20); judgment axes (lineup test, rendered composition) deliberately excluded.
Subjects: Agent-tool `haiku`/`sonnet` (n=2) and `opus` (n=1). Briefs: `facturio` (the
classic slop attractor) and `kelpwatch` (**held-out** — written for the harness, never
used to tune the skill). Raw HTML + scores: `results/2026-07-21-round1/`.

| Model      | Brief                | skill         | stock        | Δ                          |
| ---------- | -------------------- | ------------- | ------------ | -------------------------- |
| sonnet     | facturio             | 75.0 [50,100] | 15.0 [10,20] | +60.0 _(directional, n=2)_ |
| sonnet     | kelpwatch (held-out) | 70.0 [50,90]  | 40.0 [40,40] | +30.0 _(directional, n=2)_ |
| opus (n=1) | facturio             | 60            | 0            | +60 _(directional, n=1)_   |
| opus (n=1) | kelpwatch (held-out) | 100           | 60           | +40 _(directional, n=1)_   |
| haiku      | facturio             | 35.0 [30,40]  | 30.0 [20,40] | +5.0 (noise)               |
| haiku      | kelpwatch (held-out) | 80.0 [80,80]  | 80.0 [80,80] | 0                          |

Reading: the big models gain hugely from the skill — most on the slop-attractor brief
(stock Opus scored 0 on facturio: full fingerprint + failing declared contrast) — and
the held-out brief reproduces the direction, so the gain is not fixture-tuned. Haiku is
flat: same dial-consistent pattern as discipline round 2 (where the full contract
exceeds the small model's reach, the skill neither helps nor hurts). Per-cell spread
(sonnet kelpwatch [50,90]) says n must grow before finer claims.

The manual before/after protocol in [`README.md`](./README.md) remains the record for the
judgment axes this score deliberately excludes.

## Lab diary — 2026-07-12

Twenty-one chronological run notes from the day the skill was built (runs 1 through 6p)
moved verbatim to [`diary-2026-07-12.md`](./diary-2026-07-12.md). They are how the skill
reached its current shape — each run names a gap and the change it produced — but they are
a build log, not results, and they were burying both the round above and the limits below.

## Limits

Every cell above is below `MIN_N = 5`, so every delta is directional evidence and none is a
decision on its own — that is the reporting standard at the top of this file applied to its own
numbers, not a disclaimer. Two briefs and three models is a narrow base, and the mechanical
score covers only what a validator can see: composition-level judgment (hierarchy, signature,
the lineup test) stays a human call, by design. See [`README.md`](./README.md) for that protocol.

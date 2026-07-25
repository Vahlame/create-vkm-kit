# implementer-bench — results

Newest first. Raw subject outputs + graded rows under `results/<date-round>/`.

> **Reporting standard (ADR-0064).** Nothing to re-label here: this bench already
> reported a null result at n=3 without bolding it and said so in the text
> ("No verdict beyond that is claimed from n=3"). It is the behaviour
> `evals/lib/stats.mjs` now makes automatic rather than voluntary.

## 2026-07-21 · round 1 (in-session, Agent-tool subjects) — honest null result

- **Method**: spec-shaped tasks, condition `implementer` (the installed agent's real
  contract as system framing) vs `bare`; grading by discipline-bench's hidden-test
  instruments. **Models**: `haiku` (Haiku 4.5), `sonnet` (Sonnet 5); **n**: 3/cell.
- **Command**: `node evals/implementer-bench/run.mjs --grade results/2026-07-21-round1/ib-answers.jsonl`

| Task                        | Model  | implementer     | bare            | Δ                     |
| --------------------------- | ------ | --------------- | --------------- | --------------------- |
| parse-range (explicit spec) | haiku  | 100             | 100             | 0                     |
| parse-range (explicit spec) | sonnet | 100             | 100             | 0                     |
| dedupe-emails (underspec)   | haiku  | 38.7 [33,50,33] | 36.0 [50,25,33] | +2.7 (noise)          |
| dedupe-emails (underspec)   | sonnet | 74.7 [83,58,83] | 83.0 [83,83,83] | −8.3 (one 58 outlier) |

Reading, stated plainly: **the agent framing buys no measurable score on these tasks.**
Explicit specs saturate both conditions — consistent with the spec-first thesis (the
value lives in the spec, which is /vkm-spec's job, not the executor's framing). On the
underspec task the deltas are within replica spread (per-cell spread up to 25), with
one negative Sonnet cell worth re-checking at higher n. The vkm-implementer agent's
case rests on delegation ergonomics (model pinning, terse reporting, minimal-diff
discipline) rather than raw scores — and this bench now exists to catch any regression
if its contract text changes. No verdict beyond that is claimed from n=3.

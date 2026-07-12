# Results — /vkm-discipline mini-bench

Task: `parse-range` (a validating range parser). Grader: 16 hidden edge-case tests (`grade.mjs`),
score = % passed. Grader self-test: a correct reference solution scores 100, a naive happy-path one
scores 38 — the instrument discriminates. **1 replica per cell — directional, not definitive.**

Two prompt variants isolate WHERE discipline matters:

- **explicit** (`PROMPT.md`): every invalid case is spelled out — a visible contract.
- **under-specified** (`PROMPT-underspec.md`): only the format + one example; the invalid/sort/unique
  rules are NOT stated. Passing them requires INFERRING the implicit requirements — exactly what
  "deliver more than asked / validate the boundaries" produces.

| Variant                             | Model | stock | +discipline | Δ       |
| ----------------------------------- | ----- | ----- | ----------- | ------- |
| explicit (contract visible)         | Haiku | 100   | 100         | 0       |
| explicit (contract visible)         | Opus  | 100   | 100         | 0       |
| under-specified (value not visible) | Haiku | 31    | **94**      | **+63** |
| under-specified (value not visible) | Opus  | 50    | **81**      | **+31** |

## Findings

1. **No harm.** With an explicit contract every cell saturates at 100 — discipline changes nothing
   (this replicates the SOP-suite's own RUN9/RUN10: visible-contract tasks don't separate). The risk
   we were checking for — heavy doctrine _costing_ the small model — does not appear.
2. **Discipline lifts every model where it matters** (the not-visible case): +31 for Opus, +63 for Haiku.
3. **The small model gains the most and closes the gap upward.** Haiku+discipline (94) beats
   Opus+stock (50) _and_ Opus+discipline (81): a disciplined small model outperforms an undisciplined
   large one. That is the goal — lift every model as far as possible, most the weakest, without leveling down.

## Verdict

Parity — and better. The gate the user set ("bench first: confirm the kit's discipline system doesn't
hurt Haiku before retiring the SOP") is **met**: no harm on visible contracts, large gains on the
not-visible ones. Retiring the SOP-suite's cross-domain role in favour of `/vkm-discipline` is
supported by the numbers.

## Limitations (honest)

- 1 replica per cell; LLMs are non-deterministic — treat ~±10 as noise; re-run for firmer numbers.
- 1 task, 1 domain (coding); other domains not yet measured here.
- The +discipline condition injected the doctrine's operative core (the astucia loop + the coding
  domain), not the verbatim full `SKILL.md` — a small confound.
- The grader encodes one reasonable reading of the implicit spec. Both disciplined solutions still
  missed `negative-throws` (their regex allowed `-?\d+`), and opus+discipline treated empty input as
  the empty set rather than an error — arguably a design choice, not a failure. The deltas sit well
  clear of that noise.

## Reproduce

```bash
node tasks/parse-range/grade.mjs _selftest/good.mjs    # 100 (instrument check)
node tasks/parse-range/grade.mjs _selftest/naive.mjs   # 38
node tasks/parse-range/grade.mjs solutions/<cell>.mjs  # per-subject score
```

Subjects were spawned with the Agent tool (`model` = haiku/opus), stock vs the discipline doctrine
prepended, returning the function as a code block saved under `solutions/`.

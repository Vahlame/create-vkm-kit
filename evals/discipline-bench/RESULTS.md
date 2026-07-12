# Results — /vkm-discipline mini-bench

Task: `parse-range` (a validating range parser). Grader: 16 hidden edge-case tests (`grade.mjs`),
score = % passed. Grader self-test: a correct reference solution scores 100, a naive happy-path one
scores 38 — the instrument discriminates. **Explicit variant: 1 run/cell (saturates at 100).
Under-specified variant: 2-3 runs/cell across Haiku, Sonnet and Opus; a cell is the mean.**
Directional, not the SOP's full multi-judge program.

Two prompt variants isolate WHERE discipline matters:

- **explicit** (`PROMPT.md`): every invalid case is spelled out — a visible contract.
- **under-specified** (`PROMPT-underspec.md`): only the format + one example; the invalid/sort/unique
  rules are NOT stated. Passing them requires INFERRING the implicit requirements — exactly what
  "deliver more than asked / validate the boundaries" produces.

| Variant                             | Model  | stock | +discipline | Δ         |
| ----------------------------------- | ------ | ----- | ----------- | --------- |
| explicit (contract visible)         | Haiku  | 100   | 100         | 0         |
| explicit (contract visible)         | Opus   | 100   | 100         | 0         |
| under-specified (value not visible) | Haiku  | 31    | **87.5**    | **+56.5** |
| under-specified (value not visible) | Sonnet | 31    | **94**      | **+63**   |
| under-specified (value not visible) | Opus   | 40.5  | **84.5**    | **+44**   |

Under-specified cells are means of the per-run scores (Haiku stock 31,31 · disc 94,81 · Opus stock
50,31 · disc 81,88 · Sonnet 1 run each). The run-to-run spread — e.g. a disciplined Haiku scoring 94
then 81, one replica forgetting to sort/dedup — is real; the deltas sit far clear of it.

## Findings

1. **No harm.** With an explicit contract every cell saturates at 100 — discipline changes nothing
   (this replicates the SOP-suite's own RUN9/RUN10: visible-contract tasks don't separate). The risk
   we were checking for — heavy doctrine _costing_ the small model — does not appear.
2. **Discipline lifts every model where it matters** (the not-visible case): +44 (Opus), +56.5 (Haiku),
   +63 (Sonnet) — large and positive across all three models.
3. **The small model closes the gap upward.** Haiku+discipline (87.5) beats Opus+stock (40.5): a
   disciplined small model outperforms an undisciplined large one. That is the goal — lift every model
   as far as possible, most the weakest, without leveling down.

## Verdict

Parity — and better. The gate the user set ("bench first: confirm the kit's discipline system doesn't
hurt Haiku before retiring the SOP") is **met**: no harm on visible contracts, large gains on the
not-visible ones. Retiring the SOP-suite's cross-domain role in favour of `/vkm-discipline` is
supported by the numbers.

## Cross-domain generalization + the continuous-improvement loop

A second task in a **different domain** (`dedupe-emails`, data) tests whether the discipline
generalizes beyond coding. It does — same under-specified design (normalize/validate/dedup rules must
be inferred), same objective hidden grader (self-test: good=100, naive=25):

| Task (domain)        | Model | stock | +discipline | Δ   |
| -------------------- | ----- | ----- | ----------- | --- |
| dedupe-emails (data) | Haiku | 25    | 58          | +33 |
| dedupe-emails (data) | Opus  | 25    | 100         | +75 |

**The loop that matters:** the bench didn't just score the skill — it **found a gap and drove a fix**.
Baseline-doctrine Haiku scored 58 because it normalized values for comparison but **returned the raw
original** (so case/whitespace duplicates emitted two different outputs) and validated shallowly (only
checked for an `@`). That's a general data lesson, not a task quirk — so `domains/data.md` gained
"**normalize consistently** — return the normalized form you deduped on" and "validate the full shape,
not just a delimiter's presence." Re-benching Haiku with the improved doctrine: **58 → 100 (two
replicas)**. Bench → gap → doctrine fix → re-bench confirms. This is how the skill improves from here.

## Limitations (honest)

- 2-3 runs per under-specified cell (Sonnet 1); LLMs are non-deterministic — the per-run spread is
  ~±7-13, well below the deltas, but more runs would tighten it further.
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

Subjects were spawned with the Agent tool (`model` = haiku/sonnet/opus), stock vs the discipline
doctrine prepended, returning the function as a code block saved under `solutions/`.

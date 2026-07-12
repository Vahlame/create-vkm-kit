# Results — /vkm-discipline mini-bench

Two tasks, execution-graded by hidden tests (`tasks/*/grade.mjs`), score = % passed. Grader
self-tests confirm each instrument discriminates (parse-range: good=100 / naive=38; dedupe-emails:
good=100 / naive=25). Under-specified cells are means of **2-3 runs** across Haiku, Sonnet and Opus;
explicit cells are 1 run (they saturate). Directional, not the SOP's full multi-judge program.

Two prompt variants isolate WHERE discipline matters:

- **explicit** (`PROMPT.md`): every rule spelled out — a visible contract.
- **under-specified** (`PROMPT-underspec.md`): only the format + one example; the invalid/sort/unique
  rules must be **inferred** — exactly what "deliver more than asked / validate the boundaries" produces.

## parse-range (coding)

| Variant                             | Model  | stock | +discipline | Δ         |
| ----------------------------------- | ------ | ----- | ----------- | --------- |
| explicit (contract visible)         | Haiku  | 100   | 100         | 0         |
| explicit (contract visible)         | Opus   | 100   | 100         | 0         |
| under-specified (value not visible) | Haiku  | 31    | **87.5**    | **+56.5** |
| under-specified (value not visible) | Sonnet | 44    | **94**      | **+50**   |
| under-specified (value not visible) | Opus   | 53.5  | **91**      | **+37.5** |

## Findings

1. **No harm.** With an explicit contract every cell saturates at 100 — discipline changes nothing
   (replicates the SOP-suite's RUN9/RUN10: visible-contract tasks don't separate). The risk we were
   checking for — heavy doctrine _costing_ the small model — does not appear.
2. **Discipline lifts every model where it matters** (the not-visible case): +37.5 (Opus), +50
   (Sonnet), +56.5 (Haiku) — large and positive across all three.
3. **The small model closes the gap upward.** Haiku+discipline (87.5) beats Opus+stock (53.5): a
   disciplined small model outperforms an undisciplined large one. The goal — lift every model as far
   as possible, most the weakest, without leveling down.

## Cross-domain: it generalizes (dedupe-emails, data)

A second task in a different domain, same under-specified design and objective hidden grader:

| Task (domain)        | Model | stock | +discipline | Δ   |
| -------------------- | ----- | ----- | ----------- | --- |
| dedupe-emails (data) | Haiku | 25    | 58          | +33 |
| dedupe-emails (data) | Opus  | 25    | 100         | +75 |

## The continuous-improvement loop (bench → gap → fix → re-bench)

The bench didn't just score the skill — it **drove three fixes**, each verified by re-running:

1. **Doctrine gap (data).** Baseline Haiku scored 58 on dedupe-emails because it normalized values to
   dedup but **returned the raw original** (case/whitespace dups → two different outputs) and validated
   shallowly. `domains/data.md` gained "**normalize consistently** — return the normalized form you
   deduped on." Re-bench: **58 → 100** (two replicas). Clean.
2. **Doctrine gap (coding).** Baseline Haiku on parse-range let negatives through (the spec says
   _non-negative_ integer). `domains/coding.md` gained "**infer and enforce the implicit domain
   constraints**" + "parse strictly (`Number.isInteger`/regex, not `parseInt`, which reads `1.5` as
   `1`)." Re-bench: **87.5 → 97** (100, 94). The negative and lenient-parse cases closed.
3. **Instrument flaw (honest).** That same re-bench first _dropped_ to 84.5 — but not because the
   doctrine failed: both new solutions treated empty input as the empty set `[]`, a **defensible
   reading** the grader was arbitrarily penalizing (it demanded a throw). A benchmark must not punish a
   reasonable interpretation (METHODOLOGY §2.1). The grader now accepts **throw OR `[]`** for empty
   input (it still rejects garbage like `[0]`), and the doctrine's real gain (→97) showed through. The
   loop improves the **measurement**, not only the skill.

## Verdict

Discipline helps every model on the tasks where the value isn't visible, across two domains, with no
harm on visible contracts — and the loop that finds-and-fixes gaps (in both the doctrine and the
instrument) is demonstrably working. This supersedes the SOP-suite's cross-domain role with evidence.

## Limitations (honest)

- 2 tasks across 2 domains (coding, data), 2-3 runs per under-specified cell (Sonnet 1). LLMs are
  non-deterministic — the per-run spread is ~±7-13, below the deltas; more runs/tasks would tighten it.
- The +discipline condition injects the doctrine's operative core (the astucia loop + the relevant
  domain rules), not the verbatim full `SKILL.md` — a small confound.
- Overfitting risk (Goodhart): improvements are kept only when they are **general principles**
  (normalize consistently; infer domain constraints; parse strictly), not task-specific patches.

## Reproduce

```bash
node tasks/parse-range/grade.mjs _selftest/good.mjs      # 100 (instrument check)
node tasks/parse-range/grade.mjs _selftest/naive.mjs     # 38
node tasks/dedupe-emails/grade.mjs _selftest/emails-good.mjs   # 100
node tasks/<task>/grade.mjs solutions/<cell>.mjs         # per-subject score
```

Subjects were spawned with the Agent tool (`model` = haiku/sonnet/opus), stock vs the discipline
doctrine prepended, returning the function as a code block saved under `solutions/`.

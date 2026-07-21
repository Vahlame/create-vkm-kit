# token-quality-ab — does each token-saving mechanism cost answer QUALITY?

**Pre-registration.** This file states the hypotheses, metrics, and decision rule
BEFORE any run; results never edit this section, they land in `RESULTS.md` with model
id + date + n + the exact command. The kit's stance: every saving mechanism must be
A/B-tested against response quality — **a mechanism that measurably degrades answers
gets removed from the kit**, not defended.

## The question

The kit imposes several token-saving mechanisms on the agent (ADR-0032/0034/0043/0045).
Deterministic gates already pin _retrieval_ completeness; they cannot answer whether an
**agent in the loop** answers worse under each mechanism. Each experiment isolates ONE
mechanism: condition A = the kit as shipped, condition B = the kit minus that mechanism.

## Experiments

| #   | Mechanism (ADR)                    | A vs B                                        | Task family / grading (deterministic)                                               |
| --- | ---------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Passage-first doctrine (0032)      | passage-first rules vs read-whole-notes rules | Q&A over a seeded vault; grade = required-facts present + tokens from usage         |
| 2   | Default `limit` 10 vs 20 (0034)    | stock vs `VKM_DEFAULT_LIMIT=20`               | Wide-evidence queries (facts in ranks 8–14); grade = required-facts                 |
| 3   | Compact wire vs `explain` (0034)   | default vs explain-on                         | Retrieval troubleshooting; grade = state-based (found target in ≤N calls)           |
| 4   | `vkm-terse` output style (0043)    | style on vs off                               | discipline-bench tasks + explanation tasks with required-facts                      |
| 5   | `compact-tool-output` hook (0043)  | compacted log vs full log                     | **diag tasks** (`tasks/diag-*`): name the error + file:line from a real failure log |
| 6   | `compact-mcp-output` hook (0043)   | on vs off                                     | rider on #1 (whitespace-only; expected delta ≈ 0 — run for evidence, not suspicion) |
| 7   | `assemble_context` one-call (0045) | one-call rules vs free-search rules           | spec drafting; grade = `validate_spec.mjs` + citation correctness                   |
| 8   | Rules-block diet (0036, optional)  | dieted vs pre-diet rules                      | reuse #1/#7 tasks                                                                   |

## Method

- **Subjects**: agent CLI headless via `evals/lib/subject-runner.mjs` (default
  `claude -p`; the first in-session round used the Agent-tool method documented in
  `evals/discipline-bench/README.md` — same subjects-see-only-the-prompt isolation).
- **Isolation**: the subject sees the task prompt + condition materials only; graders
  and required-facts lists are never in the prompt (METHODOLOGY.md §6).
- **n**: target ≥5 tasks × 8 replicas per cell (mechanism × condition × model), models
  Haiku (the risk) + Sonnet/Opus (the ceiling), exact model id pinned per run. Reduced-n
  rounds are labelled as such in RESULTS.md and never silently pooled with full runs.
- **Metric**: task score 0–100 from the deterministic grader; delta = mean(A) − mean(B).
  Report mean ± spread per cell, never just the grand mean.

## Decision rule (fixed before running)

Per mechanism, on the quality scale 0–100:

- **Keep**: mean delta ≥ −2 and no model×task cell < −5 beyond noise
  (noise band = max spread observed across same-condition replicas).
- **Demote to opt-in (default off)**: −8 < mean delta < −2 clearing the noise band, or
  harm concentrated in one model.
- **REMOVE from the kit**: mean delta ≤ −8 clearing the noise band **reproduced in a
  second independent run**, or — for #5/#6 — any reproducible lost-diagnosis case
  (hook-on fails all 3 replicas of a diag task that hook-off passes). Removal = delete
  the mechanism's files + wiring, amend its ADR, CHANGELOG entry, and delete the CI
  gate that protected it.

Deterministic companions already gate the floor in CI (see `evals/README.md`): the
compact-diagnostics fixture gate CAUGHT and forced a fix of real diagnostic-detail loss
before any live run — evidence the pipeline works in both directions.

## Running

```bash
node evals/token-quality-ab/run.mjs --mechanism compact-tool-output --models haiku,sonnet --n 8
node evals/token-quality-ab/run.mjs --mechanism compact-tool-output --emit-prompts   # external subjects
node evals/token-quality-ab/run.mjs --mechanism compact-tool-output --grade answers.jsonl
```

Cost honesty: the full sweep ≈ 8 mechanisms × 5 tasks × 2 conditions × 2 models × 8
replicas ≈ 1,280 headless sessions. Run it per mechanism (~160 sessions, mostly Haiku),
or let the nightly workflow rotate one mechanism per night at reduced n.

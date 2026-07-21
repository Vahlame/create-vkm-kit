# token-quality-ab — results

Newest first. Decision rule is pre-registered in `README.md`; raw answers under
`results/<date-round>/`.

## 2026-07-21 · round 1 · mechanism #5 `compact-tool-output` (in-session, Agent-tool subjects)

- **Method**: subjects saw ONLY the failure log — condition A exactly as the shipped
  hook emits it (`compactText` over the fixture), condition B the raw log — and had to
  name the error identifier + file:line (deterministic grading, 50 pts each).
  Fixtures: the three adversarial CI logs (error buried mid-stream, 650–1,100 lines).
- **Models**: Agent-tool `haiku` (Haiku 4.5), `sonnet` (Sonnet 5). **n**: 3 tasks × 3
  replicas per condition per model (18 gradings/model). Reduced-n round 1.
- **Command**: `node evals/token-quality-ab/run.mjs --mechanism compact-tool-output --grade results/2026-07-21-round1/diag-answers-<model>.jsonl`

| Model  | A (compacted)           | B (raw)                 | delta (A−B) | Verdict per pre-registered rule |
| ------ | ----------------------- | ----------------------- | ----------- | ------------------------------- |
| haiku  | mean 100, spread 0, n=9 | mean 100, spread 0, n=9 | **0.0**     | **KEEP** (≥ −2)                 |
| sonnet | mean 100, spread 0, n=9 | mean 100, spread 0, n=9 | **0.0**     | **KEEP** (≥ −2)                 |

Context: the compacted arm is ~81% smaller on the wire (e.g. 38,569 → 7,185 chars on
the npm fixture) with zero measured quality loss. Note the causal chain honestly: the
deterministic gate (`compact-diagnostics.test.mjs`) first CAUGHT real detail loss and
forced the block-rescue fix — this A/B measures the hook **as fixed**. Both directions
of the pipeline worked: the gate found the defect, the A/B confirms the repair holds
with live models.

Open: mechanisms #1–#4, #6–#8 have infrastructure but no live round yet — run via
`llm-benchmarks.yml` (workflow_dispatch) or locally per README.

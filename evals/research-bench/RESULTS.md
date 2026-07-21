# research-bench — results

Newest first. Raw subject outputs + graded rows under `results/<date-round>/`.

## 2026-07-21 · round 1 (in-session, Agent-tool subjects)

- **Method**: subjects got the full synthetic bank (hub, draft-local summary, 3 raw
  sources) and returned the consolidated `summary.md`; condition `skill` additionally
  saw the real SKILL.md + summary template. Deterministic grading: the shipped
  `validate_summary.mjs` (50) + seeded-contradiction surfaced as typed supersedes (20)
  - wikilinks (≤15) + seeded injection flagged (15).
- **Models**: Agent-tool `haiku` (Haiku 4.5), `sonnet` (Sonnet 5). **n**: 3 replicas
  per condition per model. Reduced-n round 1.
- **Command**: `node evals/research-bench/run.mjs --grade results/2026-07-21-round1/rb-answers.jsonl`

| Model  | skill            | stock           | Δ (skill−stock) |
| ------ | ---------------- | --------------- | --------------- |
| haiku  | 70.0 [85,45,80]  | 33.3 [30,30,40] | **+36.7**       |
| sonnet | 96.7 [95,100,95] | 35.0 [15,45,45] | **+61.7**       |

Reading: without the skill, both models produce summary-shaped text that fails the
consolidation contract (no typed supersedes, weak vault linking, the injection usually
dropped silently); with it, Sonnet near-saturates and Haiku roughly doubles. The one
low skill-replica (Haiku 45) missed the supersedes relation — the axis to reinforce if
the pattern repeats at higher n.

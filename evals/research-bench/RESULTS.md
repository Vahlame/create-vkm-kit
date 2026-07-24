# research-bench — results

Newest first. Raw subject outputs + graded rows under `results/<date-round>/`.

> **Reporting standard (ADR-0064).** `evals/lib/stats.mjs` fixes the rule
> `METHODOLOGY.md` §5 already prescribed: a delta may be **bold** only at **n ≥ 5**
> with a bootstrap CI excluding 0. Every round below predates that rule and ran at
> n ≤ 3, so its deltas are re-labelled **directional**. The numbers are unchanged;
> only the weight put on them is.

## 2026-07-21 · round 2 (diversified: topic 2 held-out domain + Opus)

- **New**: `container-queries` topic (non-DB domain, staleness-shaped contradiction),
  Opus 4.x added at n=2; same grading. Raw data: `results/2026-07-21-round2/`.

| Model  | Topic             | skill         | stock        | Δ                          |
| ------ | ----------------- | ------------- | ------------ | -------------------------- |
| haiku  | container-queries | 90.0 [90,90]  | 55.0 [55,55] | +35.0 _(directional, n=2)_ |
| sonnet | container-queries | 97.5 [95,100] | 45.0 [45,45] | +52.5 _(directional, n=2)_ |
| opus   | container-queries | 100 [100,100] | 50.0 [45,55] | +50.0 _(directional, n=2)_ |
| opus   | sqlite-vec        | 100 [100,100] | 55.0 [55,55] | +45.0 _(directional, n=2)_ |

The skill's gain GENERALIZES: new domain, different contradiction shape, and a third
model all reproduce round 1's direction — and Opus saturates the skill condition on
both topics while stock Opus still fails the consolidation contract.

## 2026-07-21 · round 1 (in-session, Agent-tool subjects)

- **Method**: subjects got the full synthetic bank (hub, draft-local summary, 3 raw
  sources) and returned the consolidated `summary.md`; condition `skill` additionally
  saw the real SKILL.md + summary template. Deterministic grading: the shipped
  `validate_summary.mjs` (50) + seeded-contradiction surfaced as typed supersedes (20)
  - wikilinks (≤15) + seeded injection flagged (15).
- **Models**: Agent-tool `haiku` (Haiku 4.5), `sonnet` (Sonnet 5). **n**: 3 replicas
  per condition per model. Reduced-n round 1.
- **Command**: `node evals/research-bench/run.mjs --grade results/2026-07-21-round1/rb-answers.jsonl`

| Model  | skill            | stock           | Δ (skill−stock)            |
| ------ | ---------------- | --------------- | -------------------------- |
| haiku  | 70.0 [85,45,80]  | 33.3 [30,30,40] | +36.7 _(directional, n=3)_ |
| sonnet | 96.7 [95,100,95] | 35.0 [15,45,45] | +61.7 _(directional, n=3)_ |

Reading: without the skill, both models produce summary-shaped text that fails the
consolidation contract (no typed supersedes, weak vault linking, the injection usually
dropped silently); with it, Sonnet near-saturates and Haiku roughly doubles. The one
low skill-replica (Haiku 45) missed the supersedes relation — the axis to reinforce if
the pattern repeats at higher n.

# skills-triggering — results

Newest first. Raw answers live under `results/<date-round>/`.

## 2026-07-21 · round 1 (in-session, Agent-tool subjects)

- **Method**: subjects spawned as Claude Code subagents (the discipline-bench method),
  4 batches of 13 cases per model, each batch classified independently from the real
  template descriptions; deterministic grading via `run.mjs --grade`.
- **Models**: Claude Code Agent-tool `haiku` (Haiku 4.5) and `sonnet` (Sonnet 5).
- **n**: 52 labelled cases per model (10 should-trigger per skill + 12 `none`
  distractors, ES+EN). One pass per case per model — batched classification, so treat
  as round 1, not a variance estimate.
- **Command**: `node evals/skills-triggering/run.mjs --grade results/2026-07-21-round1/triggering-answers-<model>.jsonl`

| Skill          | Haiku hit / FP | Sonnet hit / FP | Gate (≥0.9 / ≤0.1) |
| -------------- | -------------- | --------------- | ------------------ |
| vkm-discipline | 100% / 0.0%    | 100% / 0.0%     | ✅                 |
| vkm-spec       | 100% / 0.0%    | 100% / 0.0%     | ✅                 |
| vkm-design     | 100% / 0.0%    | 100% / 0.0%     | ✅                 |
| vkm-research   | 100% / 0.0%    | 100% / 0.0%     | ✅                 |

Zero failures across 104 gradings, including every `none` distractor and the
obscura_research-vs-/vkm-research near-miss. Reading: the rewritten trigger-phrase
descriptions route cleanly at both model tiers. Next rounds should raise difficulty
(harder distractors) rather than n — a saturated bench stops teaching.

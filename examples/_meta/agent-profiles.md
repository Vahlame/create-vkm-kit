# Agent profiles (which model, and what it's good at)

This vault may be driven by different models, each with different strengths when deciding what to do.
On a non-trivial task, read **your** row, follow its tuning, and **append a one-line observation** when
a model clearly excelled or stumbled at a task type — over time this learns the best model per job.

> Starting defaults — general, and they evolve. Correct them with real observations below.

| Model                        | Decision-making strength                                         | Lean on it for                                    | Tune the memory                                                    |
| ---------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| Claude Opus / Sonnet         | Reliable instruction-following + tool use, structured multi-step | agentic refactors, careful reviews, self-critique | full self-check + coaching; long context OK but stay passage-first |
| Cursor Composer              | Fast in-IDE multi-file edits                                     | big mechanical edits across the codebase          | action-first; lean on STACKS/ patterns; shorter deliberation       |
| GPT (incl. reasoning models) | Planning + tool orchestration                                    | decomposing fuzzy tasks, multi-tool flows         | decompose explicitly; verify tool results before trusting them     |
| DeepSeek (V3 / R1)           | Deep, cheap code/math reasoning                                  | hard logic / algorithm problems                   | afford a deeper self-check on tricky logic; keep notes terse       |
| Gemini                       | Very large context, multimodal                                   | long-document / many-file synthesis               | may load more, but passage-first still wins on cost/latency        |

## Observations (evolving — append one line each)

Format: `date · model · task type · what worked / what to avoid`

<!-- example -->

- 2026-01-15 · Composer · auth/security change · missed an RLS edge case → add a Claude self-check pass for security-sensitive work

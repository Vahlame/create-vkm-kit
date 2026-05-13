# Evaluations

- **`adherence.yaml`** — 20 deterministic cases (stub “LLM” via `adherence-provider.cjs`). Intended for full `promptfoo` runs locally when you want reporting UI.
- **`run-adherence-ci.mjs`** — CI harness that computes `adherence_score` without promptfoo’s SQLite cache (same assertions: output must contain the fact token). Gate: **≥ 0.80** (20/20 passes → 1.0).

Local promptfoo (optional):

```bash
rm -rf .promptfoo
npx --yes promptfoo@latest eval -c evals/adherence.yaml --repeat 3
```

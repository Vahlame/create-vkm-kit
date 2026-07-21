# skills-triggering — does the listing route prompts to the right skill?

A skill's `description` is the only text an agent pre-loads; skill selection lives or
dies on it (Anthropic's authoring guidance calls this out as the thing to eval first).
This bench measures exactly that step, isolated: given the four vkm skill descriptions
**verbatim from the templates** and a user prompt, which skill (if any) would the model
invoke first?

## Dataset

`cases.jsonl` — 52 labelled prompts, ES + EN: 10 should-trigger per skill and 12
`none` distractors (questions, one-liners, tool-shaped near-misses). Each case is a
should-trigger for its label and a should-NOT for the other three, so 52 cases yield
~40 negative probes per skill. The nastiest distractor class is deliberate: "research
X on the web" must route to the `obscura_research` **tool**, not the `/vkm-research`
consolidation skill.

## Running

```bash
node evals/skills-triggering/run.mjs --emit-prompts        # subject prompts, JSONL
node evals/skills-triggering/run.mjs --grade answers.jsonl # grade external answers
ANTHROPIC_API_KEY=… node evals/skills-triggering/run.mjs --provider api --model claude-haiku-4-5-20251001
```

`--emit-prompts`/`--grade` exist so any orchestrator (a Claude Code session spawning
subagents, a CI job, another CLI) can run subjects its own way; grading is
deterministic either way. Answers format: `{"id":"spec-01","answer":"vkm-spec"}` per line.

## Gate

Per skill: **hit-rate ≥ 0.9** on its should-trigger cases and **false-positive rate
≤ 0.1** on everyone else's. `run.mjs` exits non-zero below either floor. Not a core-CI
gate (needs a live model) — it runs in the `llm-benchmarks` workflow and on demand;
results land in `RESULTS.md` with model id, date and n.

## Reading failures

- Misses on one skill → its description lacks the trigger phrasing users actually type
  (fix the description, not the case).
- False-positives from `none` cases → a description over-claims; tighten its "use when".
- Confusion between two skills → their descriptions share vocabulary; sharpen the
  contrast sentence in both.

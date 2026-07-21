# implementer-bench — does the vkm-implementer agent framing earn its keep?

Measures the kit's installed subagent (`templates/agents/vkm-implementer.md`) on the
input it was designed for: a well-specified task (spec-shaped). Conditions:
`implementer` (the agent's real contract as system framing) vs `bare` (the same spec,
no framing). Grading reuses discipline-bench's hidden-test graders verbatim
(`tasks/*/grade.mjs` — execution-graded, instrument discrimination already self-tested
there: good=100 / naive=38).

```bash
node evals/implementer-bench/run.mjs --emit-prompts --n 3
node evals/implementer-bench/run.mjs --grade answers.jsonl
```

Reading: on EXPLICIT specs both conditions may saturate (the spec carries the value —
that's the design thesis of spec-first); the interesting cells are underspec tasks and
small models. Results in `RESULTS.md` with model id, date, n, command.

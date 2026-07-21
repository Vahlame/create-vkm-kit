# spec-bench — does /vkm-spec produce mechanically valid, grounded specs?

Subjects get a vague one-line idea + the `/vkm-spec` SKILL.md contents (the skill as
shipped) + a small vault-context bundle (from `evals/assemble/corpus`), and must return
the filled spec. Grading is **deterministic**: the spec-validator that ships inside the
skill (`templates/skills/vkm-spec/scripts/validate_spec.mjs --json`) — error count,
plus a citation check (constraints must cite paths that exist in the provided bundle).

Baseline condition: the same idea WITHOUT the skill loaded (stock model). The delta
measures what the skill's structure buys, the same stock-vs-loaded design as
discipline-bench.

```bash
node evals/spec-bench/run.mjs --emit-prompts            # {id, condition, prompt} JSONL
node evals/spec-bench/run.mjs --grade answers.jsonl     # validator-based scoring
```

Validator self-test (grader discrimination) runs in core CI:
`packages/create-vkm-kit/test/validate-spec-selftest.test.mjs`.
Results land in `RESULTS.md` with model id, date, n, command.

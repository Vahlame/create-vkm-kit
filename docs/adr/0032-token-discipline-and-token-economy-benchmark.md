# ADR-0032: Token discipline distilled from caveman/ponytail + measured token-economy benchmark

- **Status:** Accepted
- **Date:** 2026-07-02
- **Deciders:** maintainer

## Context

The user asked to fuse two external tools with this kit into a
"UnifiedReasoningEngine": [caveman](https://github.com/JuliusBrussee/caveman)
(described as a step-by-step reasoning engine) and
[ponytail](https://github.com/DietrichGebert/ponytail) (described as an
execution optimizer/planner), with success criteria of +15% accuracy on
GSM8K/MATH-style suites.

Reading the actual repositories falsified the premise. Both are MIT-licensed
**prompt-discipline skills**, not reasoning engines:

- **caveman** compresses agent _output style_ ("talk like caveman", ~65–75%
  fewer output tokens), with an unusually honest eval harness: it measures
  against a terse control arm ("Answer concisely."), reports median/min/max/
  stdev, and admits its tokenizer is an approximation.
- **ponytail** enforces _code minimalism_ (a YAGNI decision ladder: reuse →
  stdlib → platform → installed dep → one line → minimal code) with explicit
  guardrails (never simplify validation/security/error handling; leave one
  runnable check), and an agentic benchmark whose key finding is that naive
  minimalism deletes safety guards — the guardrails are the point.

Building the requested engine would have required inventing functionality and
attributing it to those repos, plus fabricating benchmark results — the same
anti-pattern as the rejected MoA closed-loop proposal (vault
`KNOWN_FAILURES.md`, 2026-06-16). What IS salvageable is that both tools attack
the same axis as this kit: **token cost per agent session** (caveman: output +
memory files; ponytail: generated-code volume; the kit: passage-first input).

## Decision

Adopt the salvageable parts as three small, measurable changes:

1. **Token-discipline section in the managed rules block**
   (`memory-rules.mjs` ES/EN, synced to `AGENTS.md` and
   `docs/{es,en}/install.md`): caveman's terse-output rules (with its
   auto-clarity exception — plain prose for security warnings, irreversible
   confirmations, order-sensitive sequences) and ponytail's ladder + guardrails,
   distilled to ~10 lines. Clarity explicitly outranks compression.
2. **Token-economy benchmark** (`bench_tokens.py`, CLI `bench-tokens`, fixture
   `evals/tokens/`): measures the kit's own claim — passage-first recall vs
   whole-note reads — adopting caveman's honest-control methodology (the
   control arm already knows which note to read, so savings are a floor) and
   ponytail's completeness gate (savings only count when every ground-truth
   note surfaces in the top-k). Deterministic (hashing embedder, ~4 bytes/token
   estimator on both arms), so it gates CI like `bench-recall` (ADR-0020).
3. **Compression-safety rule** in the memory report notice (from
   caveman-compress's safety tests): when condensing notes, compress prose
   only — never drop decisions, gotchas, commands, or exact error strings.

Measured on the 16-query fixture (notes sized like a real vault: an 8.7 KB
`SESSION_LOG`, 4.4–5.5 KB PROJECTS, deliberately small <2 KB STACKS):

| k   | answered | median savings | aggregate savings |
| --- | -------- | -------------- | ----------------- |
| 3   | 100%     | 69%            | 74%               |
| 5   | 100%     | 47%            | 56%               |
| 10  | 100%     | 33%            | 42%               |

Two honest findings the benchmark surfaces instead of hiding: (a) on small
notes (STACKS bucket at k=5: −52%) reading whole is cheaper than k passages —
confirming the existing doctrine "small notes whole, big notes never"; (b)
`limit` is the agent's main token lever — k=3 answers everything on this
fixture and saves strictly more, which the rules block now recommends (low
`limit` 3–5 on targeted recalls). CI gates: median savings ≥ 0.40 and answered
rate ≥ 0.95 at k=5.

## Alternatives considered

- **UnifiedReasoningEngine as specified:** rejected. The named source modules
  ("CavemanRazoner" problem decomposition, "PonytailOptimizer" execution
  planning) do not exist in those repos; the accuracy success criteria could
  not be honestly demonstrated without running large LLM suites. Violates the
  request's own constraint ("use only what the repos actually contain").
- **Vendoring the skills verbatim** (a `/caveman`-style skill layer in the
  kit): rejected. A second prompt surface to maintain and pay input tokens for;
  distilling into the managed block the kit already installs is cheaper and
  reaches every wired agent.
- **LLM-judge benchmarks in CI** (ponytail's judge.py approach): rejected for
  CI — non-deterministic and paid. The deterministic byte-ratio benchmark gates
  CI; LLM-judged evaluation stays a local, opt-in exercise (same stance as the
  adherence harness).
- **Raising the MCP `vault_hybrid_search` default limit question now** (default
  is 20 hits ≈ 4× the k=5 cost measured here): deferred. Changing the default
  affects recall for broad queries; the rules block instead teaches agents to
  pass a low `limit` on targeted recalls. Revisit with usage data.

## Consequences

- Positive: every wired agent gets output/code discipline that caveman and
  ponytail measured to cut tokens, with the safety exceptions built in; the
  kit's token claim is now a measured, CI-gated number instead of an assertion;
  the small-note counterpoint is documented, keeping the doctrine honest.
- Negative: the managed block grows by ~10 lines (~150 tokens of input per
  session) — accepted because one avoided verbose answer or over-built diff
  pays for it many times over; the new fixture adds ~28 KB of synthetic
  Markdown to the repo.
- Neutral: `bench-tokens` mirrors `bench-recall`'s CLI/gate shape, so CI wiring
  and future levers (graph, rerank) can be measured the same way.

## References

- ADR-0018 (multi-agent token efficiency), ADR-0020/0021 (measured retrieval
  quality), ADR-0024 (memory reports), ADR-0030/0031 (enforcement hooks).
- caveman: <https://github.com/JuliusBrussee/caveman> (MIT) — SKILL.md rules,
  `evals/measure.py` methodology, caveman-compress safety tests.
- ponytail: <https://github.com/DietrichGebert/ponytail> (MIT) — SKILL.md
  ladder + guardrails, agentic benchmark's completeness/safety gates.
- Vault `KNOWN_FAILURES.md` 2026-06-16 (rejected MoA closed-loop MCP) — the
  precedent for declining fabricated-reasoning architectures.

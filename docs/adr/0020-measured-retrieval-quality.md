# ADR-0020: Measured retrieval quality (recall@k / MRR) as a CI gate

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** maintainer

## Context

The kit's central promise is behavioural: _the hybrid retrieval surfaces the
right note._ Everything downstream — passage-first reads (ADR-0018), graph fusion
(ADR-0019), the whole "memory that makes the agent better" pitch — rests on that
one claim. Yet until now it was **asserted, never measured**. We had a latency
micro-benchmark (`bench`) and unit tests that check individual rankers on toy
inputs, but **no end-to-end measurement of retrieval _quality_** against
ground-truth: nothing that would catch a change to chunking, RRF weights, the
OR-fallback or the embedder silently making recall worse.

A strategic review put it bluntly: the difference between "well built" (true) and
"demonstrably works" (only claimed) is a number. Without one, every retrieval
refactor is a leap of faith and every regression ships silently.

## Decision

Ship a **deterministic retrieval benchmark** and gate CI on it.

- **Fixed labelled corpus** in [`evals/retrieval/`](../../evals/retrieval/): a
  16-note mini-vault (`corpus/`, spanning PROJECTS / STACKS / PRACTICES / RULES /
  MEMORY with deliberately overlapping vocabulary so retrieval is non-trivial) and
  `queries.jsonl` — 18 queries labelled with their ground-truth note path(s),
  mixing lexical, conceptual-Spanish and OR-fallback cases.
- **Harness** `obsidian_memory_rag.bench_recall` scores `hybrid_search` against the
  labels and reports **recall@k**, **MRR** and **hit@1** (overall and per query
  kind). Exposed as `bench-recall` / `json-bench-recall` CLI commands with optional
  `--assert-recall/--assert-mrr/--assert-hit1` gates and a `--graph` toggle.
- **Determinism is the design constraint.** The benchmark runs on the
  dependency-free `HashingEmbedder`, so the numbers are byte-stable across machines
  and CI — they are a regression gate, not a noisy dashboard. The corpus is copied
  to a temp dir before indexing so the checked-in fixture stays pristine.
- **Gated** two ways: the `retrieval-bench` CI job runs the CLI with thresholds,
  and `tests/test_bench_recall.py` asserts the same floor (plus "graph never lowers
  the aggregate metrics" and determinism). Thresholds sit a margin below the
  measured floor.

**Measured floor (graph off):** recall@5 = 1.000, MRR = 0.972, hit@1 = 0.944. With
`--graph` the OR-fallback queries lift to MRR / hit@1 = 1.000 — the first empirical
evidence for ADR-0019's link fusion.

## Alternatives considered

- **A live-LLM adherence eval as the gate:** _deferred, not rejected_. Whether the
  _agent_ follows the protocol (passage-first, proactive recall, coaching) is the
  other half of the claim, but it is probabilistic and needs API keys — unfit for a
  deterministic CI gate. It stays a local promptfoo run (`evals/adherence.yaml`,
  documented as a smoke gate, not a measurement). This ADR measures the part we
  _can_ pin down: the retrieval layer.
- **Benchmark on the neural (`fastembed`) embedder:** rejected for the gate. Higher
  conceptual-query numbers, but model downloads + float drift make it
  non-deterministic and slow in CI. The hashing floor is what we gate; the neural
  embedder only raises it (documented in `evals/README.md`).
- **Reuse the shipped `examples/` vault as the corpus:** rejected. It is a thin
  scaffold tuned for onboarding, too small for recall@k to be meaningful. A
  purpose-built fixture with controlled distractors is a better measuring stick.
- **Larger corpus / more queries:** deferred. 16 notes × 18 queries already makes
  top-k non-trivial (random hit@5 ≈ 0.3) and MRR/hit@1 discriminating; grow it when
  a regression slips through the current set.

## Consequences

- **Positive:** the load-bearing claim is now a reproducible number that fails the
  build on regression. Refactors to chunking, RRF, the OR-fallback or the embedder
  are guarded. The benchmark is also a reusable tool (`bench-recall` works against
  any vault + query set, not just the fixture).
- **Negative:** the fixture is now a maintained asset — corpus or query edits can
  shift the metrics and require threshold review. Kept cheap by being small and
  deterministic.
- **Neutral:** recall@5 saturates at 1.000 on this corpus (k=5 over 16 notes is
  resolvable), so MRR and hit@1 are the discriminating signals; the gate leans on
  them. The corpus can be made harder if that saturation hides a regression.

## References

- ADR-0017 (hybrid query measured here), ADR-0018 (passage-first), ADR-0019 (graph
  fusion, whose benefit this benchmark first quantifies)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/bench_recall.py`,
  `packages/obsidian-memory-rag/tests/test_bench_recall.py`
- `evals/retrieval/`, `evals/README.md`, `.github/workflows/ci.yml` (`retrieval-bench`)

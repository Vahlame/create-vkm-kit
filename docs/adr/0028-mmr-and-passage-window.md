# ADR-0028: MMR diversification + passage-window expansion

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** maintainer

## Context

Two answer-quality levers that operate after fusion:

1. **Diversity.** When several near-duplicate notes are all relevant, or a cluster of
   redundant near-matches crowds the top-k, a relevance-only ranking can return five
   slices of the same idea and bury a different, also-relevant note. ADR-0021 deferred
   Maximal Marginal Relevance (MMR, "A1") because the bench was single-relevant
   dominated, so MMR could only be neutral-or-harmful there.
2. **Passage completeness.** Retrieval returns one heading-aware chunk. If the answer
   straddles a chunk boundary, the agent reads a clipped slice and can answer wrong.
   A richer contiguous passage improves _answer_ accuracy with no ranking change.

Constraint: stdlib-only, off by default, deterministic gate unchanged.

## Decision

Add both as opt-in, dependency-free post-fusion stages in `hybrid_search`.

- **MMR** — `mmr=True` reorders the fused pool greedily by
  `λ · rel(p) − (1−λ) · max_{s∈selected} cos(p, s)` (`mmr_lambda`, default 0.5),
  reusing the **L2-normalized chunk vectors already stored** (`fetch_chunk_vecs`, so
  cosine is a plain dot — works even on the dependency-free hashing embedder). A note
  with no stored vector contributes 0 similarity (treated as novel, never unfairly
  demoted). The reranker takes precedence over MMR when both are set (rerank is the
  precision authority).
- **Passage-window** — `passage_window=N` widens a chunk hit's returned snippet to its
  N adjacent chunks (`fetch_adjacent_chunks`), so the agent answers from a complete
  section without a full-note read. It changes only the returned text, **never the
  ranking** (recall@k/MRR/nDCG/MAP operate on paths).
- **Surfaces:** CLI `--mmr` / `--mmr-lambda` / `--passage-window`; MCP `mmr` /
  `passageWindow` on `vault_hybrid_search`.

## Alternatives considered

- **MMR on by default:** rejected — on a single-relevant corpus MMR demotes a
  near-duplicate of a chosen hit, which lowers recall when both are relevant (measured:
  recall 1.000 → 0.969 on the generic fixture). It is a survey/broad-recall tool, so it
  ships off; its mechanism is pinned by a deterministic unit test (it drops a
  near-duplicate for a novel note; at λ=1.0 it is pure relevance order).
- **LLM-generated contextual chunk summaries (Anthropic Contextual Retrieval):**
  rejected — needs an LLM in the loop at index time, violating the zero-dependency
  default and the kit's anti-pipeline stance. Passage-window is the stdlib
  approximation that captures most of the contiguous-context benefit.
- **Convex / normalized score fusion as an RRF alternative (ADR-0021 considered):**
  evaluated and **deferred** — fitting its one α parameter needs a de-saturated
  held-out set, but the fixture is saturated (recall 1.000) so α cannot be fit
  honestly, and parameter-free weighted RRF is robust. Revisit if the golden set
  de-saturates enough to fit and beat RRF on nDCG/MAP.

## Consequences

- **Positive:** broad-survey queries can diversify; any chunk hit can be widened to a
  complete section for more accurate answers — both opt-in, both zero-dependency.
- **Negative:** MMR is situational (it helps topically-redundant vaults, can hurt
  single-relevant ones) — documented honestly and shipped off by default.
- **Neutral:** passage-window is ranking-neutral by construction (a unit test asserts
  the path order is identical with/without it); its benefit is answer completeness,
  measured by the adherence eval, not the retrieval bench.

## References

- ADR-0021 (deferred MMR "A1" and convex fusion)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/query.py`
  (`_mmr_order`, `_expanded_passage`), `vector_store.py`
  (`fetch_chunk_vecs`, `fetch_adjacent_chunks`)
- `tests/test_retrieval_levers.py`

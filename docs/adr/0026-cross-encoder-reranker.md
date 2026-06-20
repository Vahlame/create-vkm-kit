# ADR-0026: Optional cross-encoder reranker

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** maintainer

## Context

Hybrid retrieval (ADR-0017/0019/0021) ranks with a _bi-encoder_: query and passage
are embedded **independently**, then compared by cosine and fused with BM25 via RRF.
That is fast and stateless, but a bi-encoder never sees the query and a passage
_together_, so it is weaker at the last, decisive question — "is THIS passage the
answer?" — exactly where top-1/top-3 precision is won. ADR-0021 listed a
cross-encoder reranker as a frontier item but kept it **out of the default path**
because it needs a neural model. A sibling project (a Spanish legal-knowledge vault)
since shipped a `jina-reranker-v2` cross-encoder and measured a large precision lift
(buried-relevant articles jumping to rank 1), which is the motivating evidence.

The constraint is unchanged: the Python core has **zero runtime dependencies** and
the deterministic `retrieval-bench` gate must stay byte-identical.

## Decision

Add a cross-encoder reranker as an **optional, off-by-default** final precision pass,
behind a new `[rerank]` extra; never in the default path.

- **Module `rerank.py`** mirrors `embeddings.py`: a `Reranker` protocol + a
  `FastEmbedReranker` that lazily imports `fastembed.rerank.cross_encoder.TextCrossEncoder`
  (ONNX, no torch — reuses the `[semantic]` dependency family), caches models in the
  shared durable `_fastembed_cache_dir()`, and folds the fastembed MAJOR.MINOR into a
  versioned identity. `get_reranker()` returns `None` (never raises) when disabled.
- **Insertion point:** `hybrid_search` takes a `reranker=None` param. When set, it
  widens the fused pool to `rerank_pool` (default 60), re-scores each candidate's
  **already-won passage** (chunk text → BM25 snippet → card body, so no extra read),
  reorders by the relative cross-encoder logit, keeps those within `rerank_margin`
  (default 2.0) of the top logit, and trims to `limit`. The fused RRF score is kept
  as `HybridHit.score`; the logit is exposed as `rerank_score`.
- **Default model** is `jinaai/jina-reranker-v2-base-multilingual` — the kit's vaults
  are frequently Spanish/bilingual. Overridable via `OBSIDIAN_MEMORY_RERANK_MODEL`
  (e.g. a ~90 MB English `Xenova/ms-marco-MiniLM-L-6-v2` for an English-only, lighter
  footprint).
- **Surfaces:** CLI `--rerank` / `--rerank-model` on `hybrid-search` / `json-hybrid-search`
  (the json bridge also reads `OBSIDIAN_MEMORY_RERANK` so an IDE can flip it globally
  via the MCP server env); the `vault_hybrid_search` MCP tool gains a `rerank` boolean.
- **Fail-safe:** the rerank call is wrapped — a missing extra, a model-download
  failure, or a runtime error falls back to the fused order. Reranking can only
  reorder, never break, search.
- **Measured separately, never gated.** The deterministic bench stays reranker-off.
  `bench-recall --rerank [model]` measures it on demand; it is **not** wired as a
  blocking CI gate because it needs a heavy model and is model-dependent.

## Alternatives considered

- **Cross-encoder in the default path:** rejected — it is neural, breaking the
  zero-dependency default and the deterministic gate. Opt-in extra is the compromise.
- **ColBERT / late-interaction:** rejected for now — heavier index + storage for a
  marginal gain over a cross-encoder at personal-vault scale.
- **A blocking rerank CI gate:** rejected — it would require downloading a >1 GB model
  in CI and its numbers depend on the model and content language (see below).

## Consequences

- **Positive:** a real top-k precision lever for hard/ambiguous queries, in-philosophy
  (optional, lazy, fails safe), reusing the passages retrieval already produced.
- **Negative:** the model must match the content language. Honest measurement: on the
  **Spanish** bench fixture, an **English** ms-marco cross-encoder _lowered_ recall
  (1.000 → 0.891) — a wrong-language reranker hurts. The multilingual default avoids
  this; the docs say so plainly. The bench fixture is also already saturated
  (recall 1.000), so it is not where a reranker's benefit shows — that evidence is the
  cross-encoder literature and the sibling legal-vault result.
- **Neutral:** a first download (~90 MB–1.1 GB depending on model); cached durably
  thereafter. Unit tests use a deterministic fake reranker, so the reorder + margin +
  fallback logic is covered with no model in CI.

## References

- ADR-0017 (the bi-encoder this complements), ADR-0021 (listed the cross-encoder as
  deferred-out-of-default)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/rerank.py`,
  `query.py` (`hybrid_search` reranker block), `pyproject.toml` (`[rerank]` extra)
- `tests/test_rerank.py` (deterministic fake-reranker coverage)

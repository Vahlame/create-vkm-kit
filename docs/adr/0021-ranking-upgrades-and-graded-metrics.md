# ADR-0021: Graded retrieval metrics, a harder golden set, and dependency-free ranking upgrades

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** maintainer

## Context

ADR-0020 made retrieval quality a measured CI gate, but flagged its own blind
spot: on the 16-note / 18-query fixture **recall@5 saturates at 1.000**, so the
gate could only lean on MRR and hit@1, and any ranking change that didn't move
those two shipped unmeasured. A deep-research survey of the state of the art in
agent memory / local-first RAG (Generative Agents recency, HippoRAG PPR,
Anthropic Contextual Retrieval, Bruch et al. on fusion functions, the
"Context Rot" / "Lost in the Middle" findings) recommended a concrete next stage:
**finish the measurement layer first, then ship the dependency-free ranking wins
the measurement can validate.** Most of the survey's frontier techniques were
already embodied in the kit (hybrid BM25+vector RRF, graph fusion, passage-first,
the bench itself); this ADR closes the genuine gaps.

## Decision

Five changes, all pure-stdlib, each gated by the bench.

1. **Graded, position-aware metrics — nDCG@k and MAP** (`bench_recall.py`). recall@k
   is saturated and order-blind; nDCG@k (BEIR/MTEB exponential-gain convention) and
   MAP reward putting the relevant note at rank 1 and penalize where _every_
   relevant note lands. They stay below 1.0 where recall is pinned at 1.0, so they
   discriminate ranking changes. Wired into the report, the `bench-recall` JSON/CLI
   output, `--assert-ndcg/--assert-map`, and the `retrieval-bench` CI gate.

2. **A harder, larger golden set** (`evals/retrieval/queries.jsonl`, 18 → 32). Added
   14 queries with deliberate cross-note vocabulary overlap, including a new
   **multi-relevant** kind (queries whose ground truth is two notes). This crosses
   the research's 30-query floor and — critically — **de-saturates the bench**: it
   immediately exposed a real regression (see #3).

3. **Weighted RRF** (`reciprocal_rank_fusion(weights=...)`, A2 in the survey). The
   harder set revealed that equal-weight graph fusion (ADR-0019) **drops recall@5
   from 1.000 to 0.938**: a note that is a strong BM25+cosine hit but _not_ a
   wikilink neighbour gets displaced by irrelevant neighbours, because RRF scores at
   k=60 are densely packed and an equal-weight graph term reorders aggressively. The
   fix is a sub-1 graph weight. Tuned on the bench (`GRAPH_WEIGHT = 0.1`): it fully
   restores the or-fallback benefit graph fusion exists for (or-fallback MRR
   0.750 → 1.000) while keeping graph-on aggregate recall ≥ 0.98. Lexical and
   semantic keep equal weight, so the **default (graph-off) path is byte-identical**.

4. **Title-aware BM25F matching** (`query.py`, A3). The FTS matcher only searched the
   `body` column, but `markdown_io.split_title_body` strips the H1 _out_ of the body
   — so a query for a note's own name (`sqlite`, `go`) could miss it entirely. Terms
   now match across title + body, and `search_vault` weights the title column above
   body via `bm25()` (`TITLE_WEIGHT = 2.0`). Measured neutral on the bench
   (multi-term queries already matched in body) and strictly better on
   name-matching queries (the named note now ranks first).

5. **Opt-in recency bias** (`hybrid_search(recency=...)`, B1 — the survey's top
   recommendation, and the core of this kit's evolving-memory doctrine). When
   enabled, fused scores are multiplied by an exponential decay of each note's mtime
   (`recency_factor`, 90-day half-life), so the freshest of comparably-relevant
   notes wins. The factor is ≤ 1 and 1.0 at age 0, so recency can only demote stale
   notes, never invent relevance. Exposed as `--recency` (CLI) and `recency: true`
   on the `vault_hybrid_search` MCP tool. **Off by default**: it changes ranking and
   the fixed-corpus bench has near-uniform mtimes, so per the survey's own gating it
   ships behind a flag, pinned by a deterministic unit test rather than the corpus
   bench.

**Measured floor after the changes (graph off, 32 queries):** recall@5 = 1.000,
MRR = 0.984, hit@1 = 0.969, nDCG@5 = 0.988, MAP = 0.984. Graph on: recall@5 = 0.984,
MRR = 1.000, hit@1 = 1.000, nDCG@5 = 0.985, MAP = 0.979 (or-fallback bucket fully
lifted to 1.000).

## Alternatives considered (and deferred)

The survey's remaining techniques were evaluated and deliberately _not_ shipped,
each for a measured or principled reason — recorded so a future contributor
doesn't re-litigate them blind:

- **MMR diversification (A1):** deferred. Results are already note-deduplicated
  (one chunk per note) and the bench is dominated by single/two-relevant queries,
  so MMR can only be neutral-or-harmful here. Ship it behind eval evidence when the
  corpus grows topically redundant.
- **Personalized PageRank replacing one-hop graph (B2 / HippoRAG):** deferred. The
  one-hop signal already over-reaches at equal weight (#3); a multi-hop PPR signal
  would need the same — or stronger — damping. Revisit only if multi-hop golden
  queries show one-hop missing linked notes.
- **Convex score fusion (Bruch et al.):** deferred in favour of weighted RRF, which
  the survey itself calls the more robust default; convex combination needs its one
  parameter tuned on held-out data we don't yet have.
- **Importance scoring (the second Generative-Agents factor):** deferred. The
  dependency-free heuristic (wikilink degree / edit frequency) is available via the
  graph we already parse, but it compounds with recency in ways the current bench
  can't separate. Recency alone first.
- **Edge-ordering against "lost in the middle" (C5):** rejected here. The tools
  return a ranked list the agent consumes best-first; reordering top hits to the
  edges would break that contract and the bench's rank semantics.
- **Cross-encoder rerank (A4), ColBERT/PLAID (A5), LLMLingua (C2):** out of scope —
  they need a neural model, violating the dependency-free default. Their stdlib
  approximations (weighted RRF, BM25F, TextRank) are what shipped or are noted.
- **Live-LLM adherence as a gate:** still deferred per ADR-0020 (probabilistic,
  needs API keys; stays a local promptfoo run).

## Consequences

- **Positive:** the bench now discriminates ranking changes (graded metrics + a
  de-saturated set); a real graph-fusion regression was caught and fixed _because_
  of the harder set; name-matching queries work; freshness is available on demand.
  All changes keep the zero-dependency default and the graph-off path unchanged.
- **Negative:** the golden set is a larger maintained asset, and `GRAPH_WEIGHT` /
  `TITLE_WEIGHT` are now tuned constants whose values are bench-justified (change
  them only with a bench re-run). Graph-on trades a bounded ~0.016 recall for higher
  MRR/hit@1 — acceptable because graph is opt-in.
- **Neutral:** recency is unmeasured by the corpus bench by construction; its
  contract is a unit test, and its real-world value awaits live evaluation.

## References

- Builds on ADR-0017 (hybrid query), ADR-0018 (passage-first), ADR-0019 (graph
  fusion — whose weight this ADR tunes), ADR-0020 (the bench this ADR extends).
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/{query,bench_recall}.py`,
  `packages/obsidian-memory-rag/tests/{test_hybrid,test_fts,test_bench_recall}.py`
- `evals/retrieval/queries.jsonl`, `.github/workflows/ci.yml` (`retrieval-bench`)

# ADR-0027: Type-weighted graph recall + importance (in-degree) bias

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** maintainer

## Context

Two retrieval signals were left on the table by earlier ADRs:

1. **Typed graph weighting (ADR-0021 deferred "C5").** Graph recall (ADR-0019)
   expands one hop along the `[[wikilink]]` graph, but `graphlink.neighbor_paths`
   parses _untyped_ links from the FTS bodies and scores every edge a flat +1 — it
   cannot tell that a note which _supersedes_ or _implements_ a seed is a far better
   recall signal than one that merely mentions it. ADR-0023 since added a persisted,
   typed `relations` table, which makes verb-aware weighting feasible.
2. **Importance scoring (ADR-0021 deferred).** The Generative-Agents retrieval model
   is relevance × recency × **importance**; ADR-0021 shipped recency but deferred
   importance because it "compounds with recency in ways the bench can't separate."

Constraint: both must be **off by default** (the deterministic gate stays
byte-identical), stdlib-only, and honestly measured.

## Decision

Add both as opt-in biases, deterministic and dependency-free.

- **Type-weighted graph** — new `graphlink.typed_neighbor_paths` reads the persisted
  `relations` table and weights each one-hop edge by its verb
  (`supersedes`/`superseded_by` 1.0 > `implements` 0.8 > `part_of`/`extends` 0.7 >
  `depends_on` 0.6 > `uses` 0.5 > `see_also` 0.4 > `relates_to` 0.3). It is selected
  by `hybrid_search(graph=True, graph_typed=True)` — it _replaces_ the untyped graph
  ranking in the same RRF slot (they are two implementations of one signal, never
  fused together), still entering weighted RRF at the small `GRAPH_WEIGHT = 0.1` so the
  link signal nudges but cannot outvote BM25 + cosine. The untyped path
  (`graph_typed=False`) is byte-identical to before.
- **Importance / in-degree** — new `_note_indegree` counts how many notes resolve a
  relation target to each candidate; `hybrid_search(importance=True)` multiplies the
  fused score by a **bounded** boost `1 + 0.15 · (in-degree / max-in-degree)` (≤ 1.15),
  so a hub wins among comparably-relevant notes but the boost can never invent
  relevance for an off-topic hub. Deterministic (a pure function of the corpus), unlike
  recency.
- **Surfaces:** CLI `--graph-typed` / `--importance` on `hybrid-search` and
  `bench-recall`; MCP `graphTyped` / `importance` booleans on `vault_hybrid_search`.

## Alternatives considered

- **Fold typed weighting into the untyped path (always on):** rejected — it changes
  ranking for every existing graph user and is unmeasured on a corpus without typed
  edges. A separate `graph_typed` flag keeps the change opt-in and auditable.
- **A new persisted weighted edge table:** unnecessary — the `relations` table
  already carries the verb; weighting is applied at query time over the rows it holds.
- **Importance as a `>1` unbounded boost or a separate RRF ranker:** rejected — an
  unbounded boost lets a hub dominate; a bounded multiplier (like recency's ≤ 1 decay)
  keeps it a tie-breaker, which is the honest claim.
- **Personalized PageRank / multi-hop (ADR-0021 "B2"):** still deferred — one-hop
  over-reaches at equal weight; multi-hop needs stronger damping and a multi-hop golden
  set. Type-weighted one-hop is the right next step first.

## Consequences

- **Positive:** the graph can now answer "the note this one _supersedes_" with the
  right note ranked first, and hub notes surface among ties — both proven by
  deterministic unit tests (`typed_neighbor_paths` ranks `supersedes` above
  `relates_to` even when the weak link sorts earlier; `_note_indegree` counts edges).
- **Negative:** more opt-in knobs to document. Honest measurement: on the _generic_
  single-relevant bench corpus, importance slightly perturbs MRR/MAP and type-weighting
  is ~neutral (the fixture has few typed edges) — these levers help **specific vault
  shapes** (richly typed graphs, hub-and-spoke vaults), not every query, which is
  exactly why they ship off by default.
- **Neutral:** the default retrieval path and the `retrieval-bench` gate are unchanged.

## References

- ADR-0019 (untyped graph recall), ADR-0021 (deferred C5 + importance),
  ADR-0023 (the typed `relations` table this reads)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/graphlink.py`
  (`typed_neighbor_paths`), `query.py` (`_note_indegree`, the importance multiply)
- `tests/test_retrieval_levers.py`

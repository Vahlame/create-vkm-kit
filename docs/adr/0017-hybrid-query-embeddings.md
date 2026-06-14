# ADR-0017: Hybrid query — pluggable embeddings + pure-Python cosine

- **Status:** Accepted
- **Date:** 2026-06-13
- **Deciders:** maintainer

## Context

ADR-0014 accepted hybrid retrieval (FTS5 lexical + vector semantic with RRF
fusion) as an optional sidecar and named the surface `vault_hybrid_search`. Only
the FTS5 half shipped; the vector half was deferred ("stdlib-only; sqlite-vec
deferred"). The consequence: agents could retrieve memory only by lexical match
(BM25) — effectively a smarter grep — so a query like "deployment" would miss a
note titled "shipping to production" that shares no keywords.

We want meaning-aware recall without forcing a heavyweight dependency onto the
default install: the Python core has **zero** runtime dependencies, and the kit
targets offline / privacy-conscious users. Two sub-decisions were open: how to
produce embeddings, and how to store and search vectors.

## Decision

Realize ADR-0014's vector half with two seams that keep the zero-dependency
default intact.

1. **Pluggable embedder** (`embeddings.py`, an `Embedder` protocol that mirrors
   the daemon's `Runner` seam). The default `HashingEmbedder` is pure-stdlib and
   deterministic — feature hashing over word + intra-word char-trigram features,
   bucketed with BLAKE2b (not the salted built-in `hash()`) so vectors are stable
   across processes and on disk, then L2-normalized. It is a _lexical_ vector:
   relevance-ranked and partial-match robust, a real step beyond substring grep,
   but it does not capture meaning. The optional `FastEmbedEmbedder` (ONNX MiniLM
   via `fastembed`, behind the `[semantic]` extra) provides true meaning-based
   recall. Selection is by the `OBSIDIAN_MEMORY_EMBEDDER` env var or an explicit
   name.

2. **Chunking + vector store** (`chunking.py`, `vector_store.py`). Each note is
   split into heading-aware sections and every chunk's embedding persists as a
   float32 BLOB in a `note_chunks` table inside the existing `fts.sqlite`. Search
   is a full-scan cosine (a dot product, since vectors are stored normalized) in
   Python and returns the matching **passage**, so the caller reads a section
   rather than the whole note (the main token saver). For a personal vault
   (hundreds of notes, a few thousand chunks) this is well under 10 ms — fast
   enough that a native vector extension is not yet warranted.

`hybrid_search` fuses the BM25 and vector rankings with Reciprocal Rank Fusion
(k = 60) and degrades to pure FTS when no vectors are indexed. The capability is
exposed via the CLI (`hybrid-search` / `json-hybrid-search`, and `index
--semantic`) and the `vault_hybrid_search` MCP tool.

## Alternatives considered

- **sqlite-vec for storage/search (as ADR-0014 first imagined):** _deferred, not
  rejected_. It remains the intended acceleration for very large vaults and slots
  in behind the same `vector_store` interface without changing callers. At
  personal-vault scale brute-force cosine is already sub-10 ms, so adding a native
  loadable extension (packaging variance per OS) was not yet justified.
- **Neural embeddings as the default (sentence-transformers / torch):** rejected
  as the default — hundreds of MB of dependencies breaks the zero-dependency,
  offline-friendly promise. Offered as the `[semantic]` extra (`fastembed`, no
  torch) instead.
- **No embeddings, improve FTS only (OR-semantics, field boosts):** rejected —
  still lexical; it cannot match by meaning, which was the explicit goal.

## Consequences

- **Positive:** "Query, not grep" works out of the box with zero new dependencies
  and is fully unit-testable (the hashing embedder exercises the whole hybrid path
  in CI). Neural recall is one `pip install 'obsidian-memory-rag[semantic]'` away.
  The FTS path is byte-for-byte unchanged (vectors are built in a separate
  `index_vectors` pass), so existing behavior carries no regression risk.
- **Negative:** the default embedder is lexical, not semantic — it improves
  ranking and partial matching but will not match true synonyms until the
  `[semantic]` extra is installed. Enabling semantics costs a second index pass
  (FTS walk + vector walk).
- **Neutral:** vectors are tagged with their embedder `name` + `dim`; switching
  embedders re-embeds rather than mixing incompatible vector spaces.

## References

- ADR-0014 (the decision this implements)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/{chunking,embeddings,vector_store,query,indexer}.py`
- `ARCHITECTURE.md` — Retrieval data flow

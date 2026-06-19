# ADR-0025: Optional sqlite-vec acceleration for semantic search

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** maintainer

## Context

Semantic search (ADR-0017) ranks note chunks by brute-force cosine in Python over
float32 BLOBs in `note_chunks`. That is sub-10 ms for a personal vault and was the
right call: dependency-free, deterministic, exact. But it is O(n) per query in
Python, so a _large_ vault (thousands of notes, tens of thousands of chunks) pays a
growing cost, and ADR-0014 explicitly named an embedded vector store as the future
acceleration. A common request is "deeper integration with embedded vector DBs
(Chroma, LanceDB, sqlite-vec) — a plug-and-play option for large vaults."

The constraint is the kit's defining property: **the Python core has zero runtime
dependencies, and the index is a single git-ignored `fts.sqlite` beside the vault.**
A heavy store breaks that.

## Decision

Add **sqlite-vec** as an **opt-in acceleration**, and decline Chroma / LanceDB.

- **sqlite-vec is the in-philosophy choice:** it is a single SQLite _extension_, so
  the vectors stay in the _same_ `fts.sqlite` — no server, no second store, no new
  file in the vault. Search runs `ORDER BY vec_distance_cosine(vec, :q)` over the
  existing `note_chunks` table, so there is **no schema change, no second copy of the
  vectors, and no backfill** — it reads the rows the semantic indexer already wrote.
- **Identical ranking, not approximate.** Vectors are stored L2-normalized, so
  ascending cosine _distance_ is exactly descending cosine _similarity_ — the same
  order the Python path produces. Verified on the retrieval bench: graph-off metrics
  are byte-identical with the flag on vs off (recall@5 1.000, MRR 0.984, hit@1 0.969,
  nDCG 0.988, MAP 0.984), and a parity unit test asserts the two paths return the
  same top-k. It is an acceleration, never a recall trade.
- **Opt-in, default-off, fail-safe.** Active only when the `[vec]` extra is installed
  **and** `OBSIDIAN_MEMORY_SQLITE_VEC` is truthy, so the default path stays the exact
  dependency-free brute force the bench measures. If the package is missing or the
  Python build lacks `enable_load_extension`, or the extension errors at query time,
  the code falls back transparently to brute force — enabling the flag can only speed
  search, never break it.

## Alternatives considered

- **Chroma / LanceDB:** rejected. Both are heavyweight (a server-ish client, or a
  Rust/Arrow store) that would shatter the zero-dependency default and the
  single-file index, to solve a problem that does not exist at personal-vault scale.
  sqlite-vec delivers the same "embedded vector DB" benefit while staying inside the
  one SQLite file the kit already manages.
- **A `vec0` virtual table populated alongside `note_chunks`:** rejected for now.
  It duplicates every vector and adds a second write path to keep in sync, for no
  ranking benefit over the scalar `vec_distance_cosine` on the existing rows (current
  sqlite-vec KNN is also exact/brute-force, not ANN). The scalar approach is the
  minimal change; a `vec0` index is the scale-up if/when sqlite-vec ships true ANN.
- **On-by-default when the extension is present:** rejected. Auto-activating would
  make retrieval behavior depend on whether an optional package happens to be
  installed, and could perturb exact-assertion tests by float tie ordering. Explicit
  opt-in keeps the default deterministic and the change auditable.
- **A new neural embedder for "more powerful local embeddings":** unnecessary — the
  pluggable embedder (`OBSIDIAN_MEMORY_EMBEDDER=fastembed`, ADR-0017) already
  provides neural multilingual embeddings; this ADR is about the _vector scan_, not
  the embedding model.

## Consequences

- **Positive:** large vaults get a C-speed cosine scan with no architecture change,
  no new store, and provably identical ranking. The kit's zero-dependency default and
  single-file index are untouched for everyone who does not opt in.
- **Negative:** a new optional dependency (`sqlite-vec`) and a second search code
  path to maintain. Mitigated by the parity test and the transparent fallback.
- **Neutral:** at personal-vault scale the speedup is imperceptible (brute force is
  already sub-10 ms); this is a scale investment, honestly an acceleration rather than
  a quality change.

## References

- ADR-0014 (named the embedded vector store as the future path), ADR-0017 (the
  brute-force cosine this accelerates)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/vector_store.py` — `search_chunks`
- `packages/obsidian-memory-rag/pyproject.toml` — the `[vec]` extra

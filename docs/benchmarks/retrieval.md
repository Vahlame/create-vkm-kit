# Retrieval benchmarks (v2)

Target (ADR-0014): **P95 < 150 ms** over **10k chunks** on a mid-range laptop with local embeddings.

## Current status

The `packages/obsidian-memory-rag` indexer is a **stub**; no benchmark numbers are claimed yet. When the indexer ships, record:

- hardware/OS,
- embedding model,
- SQLite page size / mmap flags,
- BM25 vs KNN vs RRF settings.

Store raw CSV under `docs/benchmarks/data/` (gitignored if large).

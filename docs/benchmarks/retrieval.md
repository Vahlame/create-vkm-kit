# Retrieval benchmarks (v2)

Target (ADR-0014): **P95 < 150 ms** over **10k chunks** on a mid-range laptop with local embeddings.

## Current status

**Shipped:** incremental **FTS5** index + BM25 search + `bench` CLI (`obsidian-memory-rag`). Run `obsidian-memory-rag bench --vault <path> --iterations 200` on your machine and paste results into your vault runbook if you track perf.

**Not shipped yet:** sqlite-vec embeddings + RRF fusion (ADR-0014 phase 2). When that lands, record:

- hardware/OS,
- embedding model,
- SQLite page size / mmap flags,
- BM25 vs KNN vs RRF settings.

Store raw CSV under `docs/benchmarks/data/` (gitignored if large).

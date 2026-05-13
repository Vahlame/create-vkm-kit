# ADR-0014: Hybrid retrieval (FTS5 + sqlite-vec) as optional RAG sidecar

- **Status:** Accepted
- **Date:** 2026-05-13
- **Deciders:** maintainer

## Context

`basic-memory` covers tool-grade read/write/search for notes. Some installations need **sub-second hybrid retrieval** over thousands of chunks (BM25 + vector KNN) without standing up a separate vector database cluster.

## Decision

Provide an **optional Python package** `obsidian-memory-rag` that builds a **SQLite** database beside the vault (`.vault.db`) using **FTS5** for lexical search and **sqlite-vec** for embeddings, with **RRF fusion** and optional reranking when models are installed. Expose results to agents via a **complementary MCP tool** (`vault_hybrid_search`) in `packages/obsidian-memory-mcp` or documented hooks—never as a hard dependency of the core install.

## Consequences

- **Positive:** Keeps default install light; power users get measurable P95 targets documented in `docs/benchmarks/retrieval.md`.
- **Negative:** Python + native extension packaging varies by OS; embedding models add disk weight.
- **Neutral:** Benchmarks are best-effort CI smoke, not guaranteed hardware-tied SLAs.

## Alternatives considered

- **Postgres/pgvector only:** Rejected as the default — too heavy for a personal vault.
- **No structured retrieval:** Rejected — leaves a gap for large vaults.

## References

- `packages/obsidian-memory-rag/`
- `docs/benchmarks/retrieval.md`

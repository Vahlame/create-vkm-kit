# obsidian-memory-rag

Optional **SQLite FTS5** sidecar for Markdown vaults (ADR-0014). Complements `basic-memory` with **incremental indexing**, **BM25 ranking**, and a **`bench`** command for local latency smoke tests.

- **Index:** `obsidian-memory-rag index --vault /path/to/vault` writes `vault/.obsidian-memory-rag/fts.sqlite` (add that folder to `.gitignore` in the vault).
- **Search:** `obsidian-memory-rag search --vault … "token1 token2"` (AND on `body`, conservative token sanitization).
- **Bench:** `obsidian-memory-rag bench --vault … --iterations 200 --query "memory"`.

**sqlite-vec** / hybrid RRF from ADR-0014 is not wired in this build; FTS5 stays dependency-free (stdlib only). Vector KNN can be added as an optional extra when packaging story is ready.

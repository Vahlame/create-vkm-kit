# obsidian-memory-rag

Optional, **dependency-free** retrieval sidecar for Markdown vaults: SQLite
**FTS5 / BM25** lexical search (ADR-0014), **hybrid** BM25 + semantic-vector
ranking fused with Reciprocal Rank Fusion (ADR-0017), and **graph-aware** recall
over your `[[wikilinks]]` (ADR-0019). Complements `basic-memory` with incremental
indexing and passage-first results (it returns the matching **section**, not the
whole note — the main token saver).

The Python core has **zero** runtime dependencies; neural embeddings are one
optional extra away (`pip install 'obsidian-memory-rag[semantic]'`).

## CLI

```sh
# Index *.md under a vault → vault/.obsidian-memory-rag/fts.sqlite
# (add that folder to the vault's .gitignore). --semantic also builds embeddings.
obsidian-memory-rag index --vault /path/to/vault [--semantic]

# Lexical BM25 search (AND on body, conservative token sanitization)
obsidian-memory-rag search --vault … "token1 token2"

# Hybrid (BM25 + semantic) — relevance-ranked, returns the matching section.
# --graph also fuses in notes one [[wikilink]] hop from the strongest hits.
obsidian-memory-rag hybrid-search --vault … "natural language query" [--graph]

# Prefix autocomplete over note titles, filenames and inline #tags (Trie)
obsidian-memory-rag complete --vault … sql

# Vault health (oversized notes, broken [[wikilinks]], SESSION_LOG size)
obsidian-memory-rag audit --vault …

# Latency smoke test
obsidian-memory-rag bench --vault … --iterations 200 --query "memory"

# Token-economy benchmark: passage-first vs whole-note reads, completeness-gated
# (ADR-0032) — includes a wire arm counting the exact compact JSON the agent
# reads (ADR-0034). The --assert-* flags turn it into a CI gate.
obsidian-memory-rag bench-tokens --corpus evals/tokens/corpus \
  --queries evals/tokens/queries.jsonl \
  [--assert-savings 0.40 --assert-answered 0.95 --assert-wire-savings 0.30]
```

Each search/index/audit/complete command has a `json-*` twin
(`json-search`, `json-hybrid-search`, `json-index`, `json-audit`,
`json-complete`) that prints one JSON object for the MCP bridge / scripting.
Searches auto-refresh the index first (D8); pass `--no-auto-index` to opt out.
The `json-search` / `json-hybrid-search` wire format is **compact by default**
(ADR-0034): hits carry `path` / `title`-or-`heading` / `snippet` (+ a 5-decimal
`score` on hybrid); pass `--explain` to include the ranking diagnostics
(`score_raw`, `bm25_rank`, `vector_rank`, `graph_rank`, `rerank_score`, raw
`bm25`, `mtime_ns`) — they cost ~20 tokens/hit, so they're opt-in.

## MCP bridge (IDE)

After `pip install -e .`, add **`obsidian-memory-hybrid`**
(`obsidian-memory-hybrid-mcp` bin, or `node …/hybrid-mcp.mjs`) to your MCP config.
Tools: **`vault_fts_search`**, **`vault_fts_index`**, **`vault_hybrid_search`**
(with optional `graph: true`; default `limit` 10 — use 3–5 for targeted recall;
`explain: true` for ranking diagnostics), **`vault_complete`**, **`vault_audit`**,
the vault-locked file tools, and **`memory_extract_candidates`**. See
`config/mcp/obsidian-memory-hybrid.json` in this repo.

## Scaling note

Vector search and graph expansion are pure-Python and read straight from
`fts.sqlite` (brute-force cosine; the link graph is parsed from the FTS bodies, so
it never goes stale). At personal-vault scale this is sub-10 ms. A native
`sqlite-vec` KNN and a persisted adjacency table slot in behind the same
interfaces when a much larger vault warrants them (ADR-0017 / ADR-0019).

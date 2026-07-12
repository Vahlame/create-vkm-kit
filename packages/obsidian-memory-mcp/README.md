# obsidian-memory-mcp

The **hybrid MCP sidecar** (Node, stdio): 15 vault tools for any MCP-capable
agent — `vault_hybrid_search` (BM25 + semantic via RRF, passage-first, compact
wire — ADR-0034), `assemble_context` (single-call budgeted context — ADR-0045),
`vault_fts_search`, `vault_complete`, the typed knowledge
graph (`vault_relations` / `vault_observations` / `vault_kg_suggest`),
vault-locked file tools, `vault_audit`, `vault_memory_report` and
`memory_extract_candidates`. Search/index/KG calls bridge to the Python engine
[`obsidian-memory-rag`](../obsidian-memory-rag/).

Private by design — it runs from the clone (`node src/hybrid-mcp.mjs`), wired
by [`create-vkm-kit`](../create-vkm-kit/) (`--ide
codex,claude,cursor` or `--full`). Config example:
[`config/mcp/obsidian-memory-hybrid.json`](../../config/mcp/obsidian-memory-hybrid.json).

Two properties the tests pin:

- **Untrusted-data envelope:** every vault payload is flagged as DATA, never
  instructions (`_trust`, injection heuristics — see `src/untrusted.mjs` and
  [`SECURITY.md`](../../SECURITY.md)).
- **Schema budget (ADR-0035):** tool descriptions + server instructions are
  capped at 8,000 chars by `test/schema-budget.test.mjs` — they're input
  tokens every wired agent pays every session, so bloat fails the build.

Full architecture and flow diagrams: [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

```sh
npm test   # node --test (58+ tests: wire contract, KG bridge, guards, budget)
```

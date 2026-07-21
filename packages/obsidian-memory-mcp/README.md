# obsidian-memory-mcp

The **hybrid MCP sidecar** (Node, stdio): **22 vault tools** for any MCP-capable
agent. Search/index/KG calls bridge to the Python engine
[`obsidian-memory-rag`](../obsidian-memory-rag/); file tools are vault-locked and
run locally (atomic writes, etag preconditions).

## The 22 tools (authoritative list)

This table is drift-gated: `test/tool-doc-drift.test.mjs` extracts every tool
registered in `src/hybrid-mcp.mjs` and fails the build if one is missing here.

### Search & retrieval

| Tool                  | One line                                                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault_hybrid_search` | BM25 + semantic fused via RRF; returns the matching **section** (passage-first, compact wire — ADR-0034). Opt-in knobs: `graph`, `graphTyped`, `recency`, `importance`, `mmr`, `passageWindow`, `rerank`, `explain`. |
| `vault_fts_search`    | Exact lexical BM25/FTS5 search — identifiers, error strings, verbatim text.                                                                                                                                          |
| `vault_fts_index`     | Incremental reindex; `semantic: true` also builds embeddings.                                                                                                                                                        |
| `vault_complete`      | Prefix autocomplete over titles / filenames / `#tags` (trie).                                                                                                                                                        |
| `assemble_context`    | One budgeted call: decisions + stack + passages for a project (ADR-0045).                                                                                                                                            |

### Knowledge graph (read-only)

| Tool                 | One line                                                              |
| -------------------- | --------------------------------------------------------------------- |
| `vault_relations`    | Typed `[[wikilink]]` relations of a note (in/out/both).               |
| `vault_observations` | Categorized `- [category] fact #tag` observations, filterable.        |
| `vault_kg_suggest`   | Proposals to structure a note (relations/observations); never writes. |

### Vault-locked file tools

| Tool                    | One line                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `vault_read_file`       | Capped UTF-8 read; returns a content `etag`.                                                 |
| `vault_write_file`      | Atomic create/overwrite (tmp+rename); opt-in `ifMatch` etag precondition (ADR-0037).         |
| `vault_edit_file`       | Exact-match find/replace edits; write-time hygiene lint (warning-only).                      |
| `vault_append_file`     | CRLF-aware append — the cheap `SESSION_LOG` one-liner path.                                  |
| `vault_frontmatter_set` | Set/remove top-level scalar YAML keys without text-matching.                                 |
| `vault_delete_file`     | Soft delete to `.trash/` by default; `permanent: true` unlinks; refuses core protocol notes. |
| `vault_move_file`       | Rename/move; refuses overwrite without `overwrite: true`; reports stale `[[wikilink]]` refs. |
| `vault_list_directory`  | List a vault directory.                                                                      |
| `vault_backlinks`       | Who `[[links]]` here — pre-delete/move impact check.                                         |
| `vault_git_history`     | Commits + old versions of a note via the sync repo — recovery even after `permanent: true`.  |

### Hygiene & memory lifecycle

| Tool                        | One line                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `vault_audit`               | Vault health: bloat, broken links, sync conflicts, git state.                                                         |
| `vault_memory_report`       | Indices + hygiene/compaction candidates + `cold_notes`; `reflect: true` adds consolidation proposals (ADR-0024/0038). |
| `vault_rotate_log`          | Archive old `SESSION_LOG` entries, keeping the newest N.                                                              |
| `memory_extract_candidates` | Close-ritual proposals with BM25 dedup flags; never writes.                                                           |

Private by design — it runs from the clone (`node src/hybrid-mcp.mjs`), wired
by [`create-vkm-kit`](../create-vkm-kit/) (`--ide
codex,claude,cursor` or `--full`). Config example:
[`config/mcp/obsidian-memory-hybrid.json`](../../config/mcp/obsidian-memory-hybrid.json).

Three properties the tests pin:

- **Untrusted-data envelope:** every vault payload is flagged as DATA, never
  instructions (`_trust`, injection heuristics — see `src/untrusted.mjs` and
  [`SECURITY.md`](../../SECURITY.md)).
- **Schema budget (ADR-0035):** tool descriptions + server instructions are
  capped at 8,000 chars by `test/schema-budget.test.mjs` — they're input
  tokens every wired agent pays every session, so bloat fails the build.
- **Doc drift (this README):** `test/tool-doc-drift.test.mjs` keeps the tool
  table above in lockstep with the registered tools.

Full architecture and flow diagrams: [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

```sh
npm test   # node --test (wire contract, KG bridge, guards, budgets, doc drift)
```

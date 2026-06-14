# MCP migration: v1 (`@smith-and-web/obsidian-mcp-server`) → v2 (`basic-memory`)

v1 used the Node package `@smith-and-web/obsidian-mcp-server` with **SSE** on `http://127.0.0.1:3001/sse`, reached from Cursor via **`mcp-remote`**. v2 defaults to **`uvx basic-memory mcp`** with **`BASIC_MEMORY_HOME`** set to the vault root (Streamable HTTP transport per MCP `2025-11-25`).

## Tool mapping (conceptual)

| v1 area (smith-and-web Obsidian MCP) | v2 `basic-memory`                            | Notes                                                                                |
| ------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| Read file / note content             | `read_note`                                  | Paths are vault-relative; mind `BASIC_MEMORY_HOME`.                                  |
| Write / create note                  | `write_note`                                 | Prefer idempotent titles / slugs.                                                    |
| Patch / update body                  | `edit_note`                                  | Review diff semantics vs v1 patch tools.                                             |
| Search / grep vault                  | `search_notes`                               | Tuning: stopwords, ranking differ from v1.                                           |
| Build context bundle                 | `build_context`                              | Replace ad-hoc “fetch many files” flows.                                             |
| Recent edits / timeline              | `recent_activity`                            | Analog to “list recent” style tools if exposed in v1.                                |
| Obsidian-app-specific hooks          | **Optional** `cyanheads/obsidian-mcp-server` | Add-on for live vault I/O; configure `OBSIDIAN_READ_PATHS` / `OBSIDIAN_WRITE_PATHS`. |

## Tools that may disappear or change names

- Any v1 tool tied to **SSE session quirks** or **deprecated MCP envelopes** should be treated as **removed**; re-map to `basic-memory` equivalents above.
- Exact v1 tool strings differ by `@smith-and-web/obsidian-mcp-server` release — treat this table as **semantic mapping**, not a literal diff.

## New / emphasized in v2

- **`build_context`** and **`recent_activity`** as first-class “agent context” helpers.
- Optional **local lexical retrieval**:
  - CLI **`obsidian-memory-rag`** (`index` / `search` / `bench`, SQLite FTS5).
  - MCP **`obsidian-memory-hybrid`** (`packages/obsidian-memory-mcp/src/hybrid-mcp.mjs`): tools **`vault_fts_index`** and **`vault_fts_search`** (BM25 JSON via Python). Sample config: `config/mcp/obsidian-memory-hybrid.json` (set `<REPO_ROOT>` + `PYTHONPATH` or `pip install -e ./packages/obsidian-memory-rag` so `python -m obsidian_memory_rag` resolves).

## v1 “final checklist” vs v2

See **`docs/migration/v1-prompt-closure.md`** for how the old Windows ultra-prompt deliverables map to v2 tooling in this public repo.

## Validation

```bash
npx --yes @modelcontextprotocol/inspector --cli uvx basic-memory mcp
```

Expect **at least**: `write_note`, `read_note`, `edit_note`, `search_notes`, `build_context`, `recent_activity`.

---
description: "How to run tests and MCP smoke checks."
globs:
  - "**/*"
alwaysApply: false
---

## Testing

- **Agents sync:** `npm run sync-agents:check` (must exit 0 in CI).
- **Static analysis:** `npm run lint` (ESLint 10 flat config, incl. type-aware promise rules) and `npm run typecheck` (strict TS scripts + `checkJs` over shipped JS via `tsconfig.checkjs.json`); both gate CI.
- **Go daemon:** `go test ./...` from repo root (`go.mod`).
- **Node packages:** `npm test` in each `packages/*` workspace.
- **Python RAG:** `pytest` under `packages/obsidian-memory-rag/`.
- **MCP smoke (local):** see `docs/en/install.md` (Verification) (`@modelcontextprotocol/inspector` + `uvx basic-memory mcp`).

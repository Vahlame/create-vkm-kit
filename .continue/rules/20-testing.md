## Testing

- **Agents sync:** `npm run sync-agents:check` (must exit 0 in CI).
- **Go daemon:** `go test ./...` from repo root (`go.mod`).
- **Node packages:** `npm test` in each `packages/*` workspace.
- **Python RAG:** `pytest` under `packages/obsidian-memory-rag/`.
- **MCP smoke (local):** see `docs/en/install.md` (Verification) (`@modelcontextprotocol/inspector` + `uvx basic-memory mcp`).

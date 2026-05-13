## Stack (repo)

- **Languages:** Markdown (vault + docs), TypeScript (tooling), Go 1.22+ (`obsidian-memoryd`), Python 3.11+ (optional RAG).
- **Runtimes:** Node 20+, Bun or `npx tsx` for maintainer scripts; `uv` for `basic-memory`.
- **Primary MCP:** `uvx basic-memory mcp` with `BASIC_MEMORY_HOME=<vault>`.
- **Optional MCP:** `cyanheads/obsidian-mcp-server` (Streamable HTTP `/mcp`) with path allowlists.
- **Bridge (legacy clients):** `mcp-remote` pinned **>= 0.1.16** (see `docs/security/mcp-remote-rce.md`).

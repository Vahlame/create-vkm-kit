# Glossary

Short, opinionated definitions of every term that appears in this repository.

## Terms

### Agent

An AI model with tools. In this repo, "agent" means any assistant that reads `AGENTS.md` (or synced IDE rules) and follows the memory protocol.

### Autosync

Keeping the vault's git history moving without manual commits. Use **`obsidian-memoryd watch`** (debounced git; default **45 s** quiet period, override with `OBSIDIAN_MEMORY_DEBOUNCE`) or **manual git** / your own scheduler. On Windows the daemon builds with `-H windowsgui` + `proc_windows.go` so neither it nor its child `git` processes flash a console.

### `basic-memory`

Default MCP server: Python package run as `uvx basic-memory mcp`. Exposes note read/write/search tools against a vault directory. Configure with **`BASIC_MEMORY_HOME`** (absolute path to the vault root). Pinned to a vetted version for supply-chain safety.

### `BASIC_MEMORY_HOME`

Environment variable pointing at the **vault root**. Same role as `OBSIDIAN_MEMORY_VAULT` in the Go daemon docs.

### Chunk

A heading-scoped section of a note. `obsidian-memory-rag` splits each note into chunks and embeds them individually, so `vault_hybrid_search` returns the **matching passage** (heading + text) instead of the whole note — the main token saver. See ADR-0017.

### Cursor

The IDE this pattern was first optimized for. The kit targets **any MCP-capable agent**; see `AGENTS.md`. The web version is out of scope for localhost MCP (see FAQ).

### Embedder

The component that turns text into a vector for semantic search (`obsidian-memory-rag`). The **default is dependency-free** (a deterministic feature-hashing embedder — lexical, but relevance-ranked). Install the `[semantic]` extra and set `OBSIDIAN_MEMORY_EMBEDDER=fastembed:<model>` for neural embeddings (e.g. a multilingual MiniLM) that match by meaning. See ADR-0017.

### FTS5

SQLite **full-text search** module used by `obsidian-memory-rag` for lexical (BM25) retrieval without a separate search cluster.

### Health endpoint

For the optional Streamable HTTP `basic-memory` listener, the URL your listener exposes. There is no fixed port assumption — verify connectivity with MCP Inspector / client logs. Default localhost port for the HTTP variant is **8765** (ADR-0016).

### Hybrid search

Relevance-ranked retrieval that fuses **FTS5 BM25** (lexical / exact terms) with **vector cosine** (semantic / meaning) via Reciprocal Rank Fusion. Exposed as the `vault_hybrid_search` MCP tool; returns the matching chunk and falls back to pure FTS when no vectors are built. See ADR-0014 / ADR-0017.

### MCP

Model Context Protocol. The protocol agents use to talk to external tools. See <https://modelcontextprotocol.io/>.

### `mcp-remote`

An npm bridge between a STDIO MCP client and a remote HTTP MCP server. Only needed for legacy / transitional setups; pin `>= 0.1.16` (`docs/security/mcp-remote-rce.md`). Prefer native Streamable HTTP clients.

### `mcp.json`

IDE-specific MCP config file. **Cursor (Windows):** typically `%USERPROFILE%\.cursor\mcp.json`. **Other OS:** follow your client's documented path.

### MEMORY.md

A file at the root of the vault holding global, durable preferences and rules — things the agent should remember across all projects.

### Obsidian MCP server

Optional live-I/O add-on `cyanheads/obsidian-mcp-server` (Streamable HTTP) for working against a running Obsidian app with path allowlists. Not required: the default `basic-memory` reads the vault directory directly, and you do not need the Obsidian desktop app if you only use filesystem conventions.

### `obsidian-memory-hybrid`

The optional Node MCP sidecar (`packages/obsidian-memory-mcp`) that exposes vault-locked file tools plus `vault_fts_search` (lexical), `vault_hybrid_search` (lexical + semantic), `vault_fts_index`, and `memory_extract_candidates`. It bridges to the Python `obsidian-memory-rag` engine.

### `obsidian-memory-rag`

Optional **Python** engine (`packages/obsidian-memory-rag`) that builds a **SQLite FTS5 + chunk-vector** index under `<vault>/.obsidian-memory-rag/` for fast BM25 and semantic search (`index`, `search`, `hybrid-search`, `bench` CLI). Dependency-free by default; neural embeddings via the `[semantic]` extra.

### PROJECTS/

A directory inside the vault containing one Markdown file per project. The agent picks the right file based on the current workspace folder name.

### Reciprocal Rank Fusion (RRF)

The merge strategy in `vault_hybrid_search`: each ranker (BM25, vector cosine) contributes `1 / (k + rank)` per result, so the two are combined robustly without sharing a score scale.

### Semantic search

Retrieval by **meaning** rather than exact keywords: the query and the note chunks are embedded as vectors and ranked by cosine similarity, so "respaldo automático de notas" can surface the git-sync note even without those exact words. Combined with lexical BM25 inside `vault_hybrid_search`. See **Embedder**, **Hybrid search**, **Chunk**.

### SESSION_LOG.md

A file at the root of the vault. Append-only log of decisions, organized chronologically.

### STDIO

The default MCP transport: an MCP server runs as a child process and speaks over its standard input/output. No ports, no network.

### Streamable HTTP

The optional HTTP MCP transport (e.g. for an always-on `basic-memory` listener you run). Default localhost port **8765** (ADR-0016).

### Task Scheduler

Windows' built-in cron equivalent (`schtasks.exe`). Optional way to run vault git sync on an interval if you prefer it over `obsidian-memoryd` (see `docs/setup/windows-scheduled-vault-sync.md`).

### User Rules

Free-text instructions you paste into `Cursor Settings -> Rules -> User Rules`. Cursor injects them into every conversation. Use the ready-to-paste block in `docs/cursor-memory-setup.md`, aligned with the MCP server names `basic-memory` and optional `obsidian-memory-hybrid`.

### Vault

The directory your MCP server reads and writes (Markdown + git). Any path; set **`BASIC_MEMORY_HOME`** to the vault root. Plain-language overview: `docs/how-memory-works-simple.md`.

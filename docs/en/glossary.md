> [🇪🇸 Español](../es/glosario.md) · 🇬🇧 English

# Glossary

Short, plain-language definitions of every term that appears in this repository. No prior knowledge assumed.

Terms are listed **A–Z**. For the bigger picture of how the pieces fit together, see [How it works](./how-it-works.md).

## Terms

### Agent

An AI model that can use tools. In this repo, "agent" means any assistant that reads `AGENTS.md` (or the equivalent rules synced into your IDE) and follows the memory protocol. The [Cursor](#cursor) assistant is one example, but the kit works with any tool-capable agent.

### Autosync

Keeping the [vault](#vault)'s git history moving without you having to commit by hand. You can use **`obsidian-memoryd watch`** (a small background program that commits for you after a quiet pause — default **45 seconds**, configurable with `OBSIDIAN_MEMORY_DEBOUNCE`), plain **manual git**, or your own scheduler. On Windows the background program is built with `-H windowsgui` plus `proc_windows.go` so that neither it nor the `git` processes it launches ever flash a console window on screen.

### `basic-memory`

The default [MCP](#mcp) server. It is a Python program run as `uvx basic-memory mcp`, and it gives the agent tools to read, write, and search notes inside a [vault](#vault) folder. You point it at your vault with the [`BASIC_MEMORY_HOME`](#basic_memory_home) setting. It is pinned to a vetted version (`basic-memory==0.21.4`) so a malicious update can't slip in automatically.

### `BASIC_MEMORY_HOME`

An environment variable (a named setting your computer passes to a program) that holds the absolute path to the **root of your [vault](#vault)**. It plays the same role as `OBSIDIAN_MEMORY_VAULT` in the Go daemon's documentation.

### Chunk

A heading-scoped slice of a note — roughly, everything under one heading. [`obsidian-memory-rag`](#obsidian-memory-rag) splits each note into chunks and indexes them one by one, so a search returns just the **matching passage** (its heading plus text) instead of the whole note. That is the main reason searches stay small and cheap. See ADR-0017.

### Cursor

The code editor (IDE) this pattern was first tuned for. The kit itself targets **any MCP-capable agent** — see `AGENTS.md` — so Cursor is just the starting point, not a requirement. The browser-based version of Cursor can't reach a localhost MCP server, so it is out of scope (see the FAQ).

### Embedder

The component that turns text into a list of numbers (a "vector") so the computer can compare passages by meaning — the engine behind [semantic search](#semantic-search). The **default needs no extra downloads**: it is a deterministic, dependency-free embedder that ranks by keyword overlap. For true match-by-meaning (catching synonyms), install the `[semantic]` extra and set `OBSIDIAN_MEMORY_EMBEDDER=fastembed:<model>` to use a neural model (for example a multilingual MiniLM). See ADR-0017.

### FTS5

SQLite's built-in **full-text search** module. [`obsidian-memory-rag`](#obsidian-memory-rag) uses it for fast keyword (BM25) lookups without needing a separate search server. (SQLite is a tiny, file-based database; BM25 is a standard recipe for ranking results by keyword relevance.)

### Health endpoint

For the optional [Streamable HTTP](#streamable-http) [`basic-memory`](#basic-memory) listener, this is the web address your listener exposes so you can confirm it is alive. There is no fixed port you must assume — check connectivity with MCP Inspector or your client's logs. The default localhost port for the HTTP variant is **8765** (ADR-0016).

### Hybrid search

A search that fuses two methods to rank results: [FTS5](#fts5) **BM25** (matching exact keywords) and **vector cosine** (matching meaning), combined with [Reciprocal Rank Fusion](#reciprocal-rank-fusion-rrf). It is exposed as the `vault_hybrid_search` [MCP](#mcp) tool, returns the matching [chunk](#chunk), and quietly falls back to keyword-only search when no [semantic](#semantic-search) vectors have been built yet. See ADR-0014 / ADR-0017.

### MCP

**Model Context Protocol** — the shared language an [agent](#agent) uses to talk to external tools (like the memory tools in this kit). See <https://modelcontextprotocol.io/>.

### `mcp-remote`

A small npm program that acts as a bridge between an [STDIO](#stdio) MCP client and a remote HTTP MCP server. You only need it for older or transitional setups; if you do use it, pin version `>= 0.1.16` for safety (see `docs/security/mcp-remote-rce.md`). When possible, prefer a client that speaks [Streamable HTTP](#streamable-http) natively instead.

### `mcp.json`

The configuration file where you tell your IDE which MCP servers to run. **Cursor on Windows:** usually `%USERPROFILE%\.cursor\mcp.json`. **Other operating systems:** follow the path your client documents.

### MEMORY.md

A file at the top of the [vault](#vault) that holds global, long-lived preferences and rules — the things the [agent](#agent) should remember across every project.

### Obsidian MCP server

An optional add-on (`cyanheads/obsidian-mcp-server`, over [Streamable HTTP](#streamable-http)) for working against a **running Obsidian app**, with folder allowlists for safety. It is not required: the default [`basic-memory`](#basic-memory) reads the [vault](#vault) folder directly, and you don't need the Obsidian desktop app at all if you only rely on the plain-file conventions.

### `obsidian-memory-hybrid`

The optional Node.js companion server (`packages/obsidian-memory-mcp`). It exposes [vault](#vault)-locked file tools plus `vault_fts_search` (keyword), `vault_hybrid_search` (keyword + meaning), `vault_fts_index` (build the index), `memory_extract_candidates`, and [`vault_audit`](#vault_audit) (vault health: notes over the token budget, broken [[wikilinks]], `SESSION_LOG` size). Under the hood it hands the heavy lifting to the Python [`obsidian-memory-rag`](#obsidian-memory-rag) engine.

### `obsidian-memory-rag`

The optional **Python** engine (`packages/obsidian-memory-rag`) that builds a **[SQLite](#fts5) FTS5 + chunk-vector** index under `<vault>/.obsidian-memory-rag/`, enabling fast keyword (BM25) and [semantic](#semantic-search) search. It ships an `index` (accepts `--semantic` to build neural vectors), `search`, `hybrid-search`, `bench`, [`audit`](#vault_audit), and `rotate-log` command line. `search` auto-indexes before querying (pass `--no-auto-index` to disable). Dependency-free by default; neural embeddings are available through the `[semantic]` extra.

### PROJECTS/

A folder inside the [vault](#vault) holding one Markdown file per project. The [agent](#agent) picks the right file by matching the name of the workspace folder you currently have open.

### Reciprocal Rank Fusion (RRF)

The merge rule used by [hybrid search](#hybrid-search) to combine two result lists. Each ranker (BM25 and vector cosine) contributes `1 / (k + rank)` for every result, where `rank` is that result's position in the list. This blends the two lists robustly **without** needing their scores to share a common scale.

### Semantic search

Finding notes by **meaning** rather than by exact words. The query and the note [chunks](#chunk) are turned into vectors (see [Embedder](#embedder)) and ranked by cosine similarity, so a query like "automatic note backup" can surface the git-sync note even if it never uses those exact words. Inside [hybrid search](#hybrid-search) it is blended with keyword (BM25) matching. See also [Embedder](#embedder), [Hybrid search](#hybrid-search), [Chunk](#chunk).

### SESSION_LOG.md

A file at the top of the [vault](#vault). An append-only log of decisions, kept in chronological order.

### STDIO

The default way an MCP server connects ("transport"). The server runs as a child process and talks over its standard input and output streams — no network ports, no listening on the internet. (STDIO = standard input/output.)

### Streamable HTTP

The optional way to run an MCP server over HTTP instead of [STDIO](#stdio) — for example, an always-on [`basic-memory`](#basic-memory) listener you keep running. Default localhost port **8765** (ADR-0016).

### Task Scheduler

Windows' built-in scheduler (`schtasks.exe`), the equivalent of cron on other systems. An optional way to run the [vault](#vault) git sync on a timer if you prefer it over `obsidian-memoryd` (see [`sync.md`](./sync.md)).

### User Rules

Free-text instructions you paste into `Cursor Settings -> Rules -> User Rules`. [Cursor](#cursor) injects them into every conversation automatically. Use the ready-to-paste block in [`install.md`](./install.md#step-4--paste-the-user-rules-into-cursor) (Step 4), which is aligned with the MCP server names [`basic-memory`](#basic-memory) and the optional [`obsidian-memory-hybrid`](#obsidian-memory-hybrid).

### Untrusted-data envelope (`_trust`)

A defense-in-depth wrapper applied when the agent **reads** from the [vault](#vault). Because note contents are data the agent should never obey, [`vault_read_file`](#obsidian-memory-hybrid) output is delimited as `<untrusted-vault-data>` with a one-line "treat as data, not instructions" header, and lines that look like injected commands are flagged. Search hits from [`vault_fts_search`](#hybrid-search) / [`vault_hybrid_search`](#hybrid-search) carry a `_trust` field plus a per-hit `injectionFlagged` marker. This sits behind the written trust rule in `SECURITY.md` (§Trust model). See ADR-0018 (D6).

### Vault

The folder your MCP server reads from and writes to — plain Markdown files tracked with git. It can live at any path; set [`BASIC_MEMORY_HOME`](#basic_memory_home) to its root. For a plain-language overview, see [How it works](./how-it-works.md).

### `vault_audit`

A vault-health check, available both as the `vault_audit` [MCP](#mcp) tool (via [`obsidian-memory-hybrid`](#obsidian-memory-hybrid)) and as the `audit` / `json-audit` subcommands of the [`obsidian-memory-rag`](#obsidian-memory-rag) CLI. It reports notes that exceed the per-note token budget (~8k), broken `[[wikilinks]]` (a stale-memory signal), and the size of `SESSION_LOG.md`. Pair it with the `rotate-log` command, which archives old `##` sections to `SESSION_LOG/archive.md`. See ADR-0018.

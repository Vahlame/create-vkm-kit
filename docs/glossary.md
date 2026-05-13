# Glossary

Short, opinionated definitions of every term that appears in the prompt or this repository.

## Terms

### Agent

An AI model with tools. In this repo, "agent" means any assistant that reads `AGENTS.md` (or synced IDE rules) and follows the memory protocol.

### Autosync

**v1 (Windows):** the scheduled task `CursorMemoryAutoSync` often ran a vault-local automation on a short timer to commit and push the vault. **v2:** use **`obsidian-memoryd watch`** (debounced git; default **45 s** quiet period, override with `OBSIDIAN_MEMORY_DEBOUNCE`) or **manual git**; this public guide does not ship Windows script templates to copy.

### `basic-memory`

Default **v2** MCP server: Python package run as `uvx basic-memory mcp`. Exposes note read/write/search tools against a vault directory. Configure with **`BASIC_MEMORY_HOME`** (absolute path to the vault root).

### `BASIC_MEMORY_HOME`

Environment variable pointing at the **vault root** for `basic-memory`. Same role as `OBSIDIAN_MEMORY_VAULT` in the Go daemon docs.

### Cursor

The IDE this pattern was first optimized for. **v2** targets **any MCP-capable agent**; see `AGENTS.md`. The web version is still out of scope for localhost MCP (see FAQ).

### Doctor

`Doctor.ps1`. The end-to-end **connectivity** validation script that the prompt generates. Checks git/node/npm, vault path, `mcp.json` shape, MCP `/health`, and that both scheduled tasks exist. Reports `[OK]`, `[WARN]`, `[FAIL]` per check and exits non-zero on any failure.

### Vault Doctor

`Vault-Doctor.ps1`. The **content hygiene** audit script (Markdown sizes, duplicate `##` headings, empty directories, YAML frontmatter coverage, broken `[[wikilinks]]`, secret-like regex hits, whether tasks invoke `powershell.exe` directly, presence of `.gitignore`, stale installer files at vault root). Exits `1` only if there is at least one `[FAIL]` (for example a secret pattern match). Optional `-WriteReview` writes `REVIEW_YYYY-MM-DD.md` at the vault root. See ADR-0008.

### Health endpoint

**v1:** `http://127.0.0.1:3001/health` on the smith-and-web SSE stack. **v2:** depends on the server you run; use MCP Inspector / client logs rather than assuming `:3001`.

### MCP

Model Context Protocol. The protocol Cursor uses to talk to external tools. See <https://modelcontextprotocol.io/>.

### `mcp-remote`

An npm package that bridges Cursor's STDIO MCP client to a remote SSE MCP server. The reason we use it is in ADR-0001.

### `mcp.json`

IDE-specific MCP config file. **Cursor (Windows):** typically `%USERPROFILE%\.cursor\mcp.json`. **Other OS:** follow your client's documented path.

### MEMORY.md

A file at the root of the vault holding global, durable preferences and rules. Things the agent should remember across all projects.

### Obsidian MCP server

**v1:** `@smith-and-web/obsidian-mcp-server` (SSE). **v2 default:** `basic-memory` via `uvx`. Optional live I/O: `cyanheads/obsidian-mcp-server`. Despite the Obsidian branding, you do not necessarily need the Obsidian desktop app if you only use filesystem conventions.

### `obsidian-memory-rag`

Optional **Python** sidecar (`packages/obsidian-memory-rag`) that builds a **SQLite FTS5** index under `<vault>/.obsidian-memory-rag/` for fast BM25 search (`index`, `search`, `bench` CLI). Complements `basic-memory` on large vaults.

### FTS5

SQLite **full-text search** module used by `obsidian-memory-rag` for lexical retrieval without a separate search cluster.

### PROJECTS/

A directory inside the vault containing one Markdown file per project. The agent picks the right file based on the current workspace folder name.

### SESSION_LOG.md

A file at the root of the vault. Append-only log of decisions, organized chronologically.

### SSE

Server-Sent Events. The HTTP-based transport the MCP server speaks. One-way push of newline-delimited JSON from server to client. Combined with regular HTTP POST for client-to-server messages.

### STDIO

The transport Cursor's MCP client uses to talk to MCP servers it spawns: standard input and output of a child process. The reason `mcp-remote` exists is to translate between STDIO and SSE.

### Task Scheduler

Windows' built-in cron equivalent (`schtasks.exe`). Used to schedule the watchdog and the autosync.

### User Rules

Free-text instructions you paste into `Cursor Settings -> Rules -> User Rules`. Cursor injects them into every conversation. **v2:** use the ready-to-paste blocks in `docs/cursor-memory-setup.md` (ES) / `docs/cursor-memory-setup.en.md` (EN), aligned with MCP server names `basic-memory` and optional `obsidian-memory-hybrid`. **v1:** the archived ultra-prompt’s section 9 generated a similar block for the old SSE stack.

### Vault

The directory your MCP server reads and writes (Markdown + git). **v1** docs often used `%USERPROFILE%\Documents\cursor-memory-vault`. **v2:** any path; set **`BASIC_MEMORY_HOME`** to the vault root. Plain-language overview: `docs/how-memory-works-simple.md` / `.en.md`.

### Watchdog

**v1 (Windows):** scheduled task `CursorObsidianMcpWatchdog` running `Ensure-ObsidianMcp.ps1` to restart the SSE MCP server. **v2:** rely on the IDE to restart `uvx` children, or use your own process supervisor; not part of this repo's default cross-platform kit.

### `wscript.exe`

Windows Script Host. Older **private v1 vaults** sometimes used `wscript.exe` with a `.vbs` shim so scheduled tasks did not flash a console. The **public v2 guide** does not document copy-paste VBS/PowerShell task templates; see ADR-0003 for historical rationale.

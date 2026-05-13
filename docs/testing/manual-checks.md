# Manual checks (IDE + MCP)

These steps require a local machine with **Node 20+**, **Python/uv** (for `uvx`), and (for IDE checks) the corresponding product installed.

## 1. Symlinks (Unix / Windows with `core.symlinks=true`)

```bash
readlink CLAUDE.md    # expect: AGENTS.md
readlink .clinerules # expect: AGENTS.md
```

On Windows without symlink privileges, clone with `git config core.symlinks true` and Developer Mode enabled, or extract the archive on WSL.

## 2. `basic-memory` via MCP Inspector

```bash
npx --yes @modelcontextprotocol/inspector --cli uvx basic-memory mcp
```

Confirm tools include `write_note`, `read_note`, `edit_note`, `search_notes`, `build_context`, `recent_activity`.

## 3. Streamable HTTP

With `obsidian-live` or any Streamable HTTP server you configure, verify **`POST /mcp`** accepts the session header your client sends (see server docs). Record the working curl in your vault runbook.

## 4. IDE rule injection (smoke)

| IDE / agent                           | What to verify                                                          |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Cursor                                | `.cursor/rules/*.mdc` present; rules appear in Cursor Settings → Rules. |
| Claude Code                           | `CLAUDE.md` resolves to `AGENTS.md` content.                            |
| GitHub Copilot (Codespaces / VS Code) | `.github/copilot-instructions.md` resolves.                             |
| Codex CLI / Zed / Windsurf            | Reads `AGENTS.md` per product docs.                                     |

## 5. Agent sync CI parity

```bash
npm install
npm run sync-agents:check
```

## 6. Local FTS5 sidecar (`obsidian-memory-rag`)

For large vaults, `basic-memory` search is tool-grade; this package adds a **local SQLite FTS5** index (BM25, incremental by `mtime`/`size`) under `vault/.obsidian-memory-rag/`.

```bash
pip install -e ./packages/obsidian-memory-rag
obsidian-memory-rag index --vault /abs/path/to/vault
obsidian-memory-rag search --vault /abs/path/to/vault "your terms"
obsidian-memory-rag bench --vault /abs/path/to/vault --iterations 200 --query "memory"
```

Expect `bench` p50 in the low milliseconds on a warm OS page cache for typical personal vaults (not a formal SLA).

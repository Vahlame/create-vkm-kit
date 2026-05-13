# Cursor + Markdown memory (v2): MCP, vault, and User Rules

**Repo flow:** if you are new, start with [`../GETTING_STARTED.en.md`](../GETTING_STARTED.en.md) and [`how-memory-works-simple.en.md`](./how-memory-works-simple.en.md); this file is the **Cursor deep dive** (MCP + User Rules + verification).

This guide ties together README, `AGENTS.md`, v1→v2 migration, and the legacy prompt. **Goal:** clarity on _what_ to configure, _where_, and _why_.

## Recommended flow (at a glance)

| Step | What you do                                            | Where                                                                                                                                                                                                                                                                          |
| ---- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Linear step table                                      | [`GETTING_STARTED.en.md`](../GETTING_STARTED.en.md)                                                                                                                                                                                                                            |
| 2    | Mental model: vault / MCP / User Rules                 | [`how-memory-works-simple.en.md`](./how-memory-works-simple.en.md)                                                                                                                                                                                                             |
| 3    | Merge `mcp.json` for your vault (fast) or edit by hand | [Step 4](#step-4-headless-merge-into-mcpjson) and [`../config/mcp/`](../config/mcp/)                                                                                                                                                                                           |
| 4    | MCP + verify tools + **User Rules**                    | [Steps 1–3](#step-1-configure-mcp-in-cursor) in this guide                                                                                                                                                                                                                     |
| 5    | Inspector and checks                                   | [`testing/manual-checks.md`](./testing/manual-checks.md)                                                                                                                                                                                                                       |
| 6    | (Windows only) Git autosync, always-on HTTP MCP, smoke | [`setup/windows-scheduled-vault-sync.en.md`](./setup/windows-scheduled-vault-sync.en.md), [`setup/windows-basic-memory-always-on.en.md`](./setup/windows-basic-memory-always-on.en.md), [`testing/windows-memory-sync-smoke.en.md`](./testing/windows-memory-sync-smoke.en.md) |

## Three layers (why one is not enough)

| Layer             | What it is                                                                                                  | Why it matters                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Vault**         | Directory of Markdown (and git): `START_HERE.md`, `MEMORY.md`, `PROJECTS/`, etc.                            | **Your** memory: editable outside the IDE, versioned, backed up.                                                                 |
| **MCP in Cursor** | Entries in your Cursor `mcp.json` that spawn processes (`uvx basic-memory mcp`, optionally the FTS hybrid). | Without MCP, the agent has **no tools** to read/write the vault.                                                                 |
| **User Rules**    | Text in `Cursor → Settings → Rules → User Rules`.                                                           | Tells the model **when** to open which note and **how** to close sessions. It does **not** replace MCP; it only guides tool use. |

No vault → no data. No MCP → no tools. No User Rules → the model may skip the reading flow or never touch `SESSION_LOG.md`.

## Machine requirements

### Node 20+

Required for Cursor and, if you use the hybrid, for `node …/hybrid-mcp.mjs`.

### uv

For `uvx basic-memory mcp`. Windows install:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
```

Restart Cursor or the terminal so `uvx` is on your user `PATH` (typically `~/.local/bin`).

### Vault path

Historical example: `%USERPROFILE%\Documents\cursor-memory-vault`. Must match **`BASIC_MEMORY_HOME`** in `mcp.json`.

### (Hybrid optional) Python 3.11+ and the RAG package

Typical install from a clone of this repo:

```powershell
python -m pip install -e "C:\path\to\repo\packages\obsidian-memory-rag"
```

The hybrid runs `python -m obsidian_memory_rag …`. If the module does not resolve, see `docs/troubleshooting.md` and `docs/testing/manual-checks.md` §7.

## Step 1: Configure MCP in Cursor

**File (Windows):** `%USERPROFILE%\.cursor\mcp.json`. Other OS: follow Cursor’s documented path.

### How Cursor reaches `basic-memory`: stdio vs URL

- **stdio (default recommendation):** `mcp.json` uses `command` + `args` (`uvx basic-memory mcp`) and `env.BASIC_MEMORY_HOME`. Cursor **spawns** the process when needed; no local port required.
- **URL / Streamable HTTP (optional, mainly Windows “always on”):** the entry is only `"url": "http://127.0.0.1:8765/mcp"` (see `config/mcp/basic-memory-streamable-http.json`). A process must be **listening before** Cursor connects (e.g. `CursorBasicMemoryHttpMcp`). If not, MCP logs show `fetch failed` / `streamableHttp`; see [`docs/troubleshooting.md`](./troubleshooting.md) and [`docs/setup/windows-basic-memory-always-on.en.md`](./setup/windows-basic-memory-always-on.en.md).

### `basic-memory` over stdio (minimum recommended)

Copy `config/mcp/basic-memory.json` and replace `<VAULT_PATH>` with the **absolute** vault root (JSON on Windows: `\\` or `/`).

**What `BASIC_MEMORY_HOME` does:** tells `basic-memory` the vault root; all tool paths are **relative to that root**.

### Add FTS hybrid (optional)

Merge `config/mcp/obsidian-memory-hybrid.json`: replace `<REPO_ROOT>` with the **absolute** path to this repo clone and `<VAULT_PATH>` with your vault (or rely on `BASIC_MEMORY_HOME` on that entry if you set it).

**Why two servers:** `basic-memory` handles read/write and built-in search. The hybrid adds an on-disk **SQLite FTS5 (BM25)** index for very large vaults where `search_notes` is not enough.

## Step 2: Verify Cursor sees the tools

1. **Cursor → Settings → MCP** — `basic-memory` should be green (check logs if red).
2. MCP Inspector (`docs/testing/manual-checks.md` §2): expect at least `read_note`, `write_note`, `edit_note`, `search_notes`, `build_context`, `recent_activity`.

If `uvx` fails, it is usually **missing uv** or **PATH not refreshed**; see `docs/troubleshooting.md`.

## Step 3: User Rules (paste into Cursor)

**Cursor → Settings → Rules → User Rules** — paste the block below. **Important:** the names `basic-memory` and `obsidian-memory-hybrid` must match your `mcpServers` keys in `mcp.json`. If you renamed a server, update the rules text to match.

```markdown
## Markdown memory (vault + MCP v2)

**Why:** the model does not persist across chats; a git-backed vault is yours, auditable, and portable.

### Not the same as Cursor’s built-in memory

- **`memory://...` resources** (toasts or links) are **native / virtual IDE memory**, not files in your vault.
- This flow lives in **Markdown on disk** only through **vault MCP tools** (`read_note`, `write_note`, …). To read or change a vault note, use those tools; do not treat `memory://` as the vault.

### How `basic-memory` is wired (stdio vs URL)

- If `mcp.json` uses **`command` + `uvx`** for `basic-memory`, that is **stdio**: Cursor starts the server; no fixed HTTP port is required.
- If the **`basic-memory` entry is only `"url"`** (e.g. `http://127.0.0.1:8765/mcp` or **another port** if you changed it for conflicts), an **HTTP server must already be running** (e.g. `CursorBasicMemoryHttpMcp` on Windows). With nothing listening on that port you get `fetch failed` in MCP logs.
- ASCII banners or `undefined` lines on server stderr are often **startup noise**; what matters is listed tools and a working MCP panel.

### MCP availability

- When **`basic-memory`** is active, use it for the vault: `read_note`, `write_note`, `edit_note`, `search_notes`, `build_context`, `recent_activity`. Paths are relative to the vault root (`BASIC_MEMORY_HOME`).
- When **`obsidian-memory-hybrid`** is also active, use `vault_fts_search` for BM25/FTS5 lexical search; after bulk imports or first-time indexing on a large vault, run `vault_fts_index`. If the hybrid is not configured, use `search_notes` from `basic-memory` only.
- If **no** vault MCP is available, say so explicitly; do not claim you persisted to the vault.

### Startup (tasks that need vault context)

1. `read_note` the vault entry file (e.g. `START_HERE.md`).
2. `read_note` `MEMORY.md`.
3. Use or create `PROJECTS/<project>.md` for the current folder or repo name; read it if it exists (`<project>` = short stable id).

### On-demand (only when relevant)

- Hard rules: `RULES/<project>.md`.
- Sprint history: `PROJECTS/<project>/SPRINTS.md`.
- Runbook: `PROJECTS/<project>/RUNBOOK.md`.
- Failure patterns: `KNOWN_FAILURES.md`.
- Tag index: `TAGS.md`.

### During the task

- Log important decisions in `PROJECTS/<project>.md` or `SPRINTS.md` for sprint closures.
- Never store secrets, tokens, JWTs, or literal hardware IDs.
- Avoid noise: append to `SESSION_LOG.md` only on real progress (every few turns or when closing).

### When closing the task

- Short append to `SESSION_LOG.md` (date, project, outcome or decision).
- Cross-cutting lessons in `MEMORY.md`.
- New hard rule in `RULES/<project>.md`.
- Discarded approach in `KNOWN_FAILURES.md` with reason.

### Style

- Short, actionable notes; separate **facts** vs **hypotheses** explicitly.
- Use wikilinks `[[...]]` when they help navigation.
```

## Step 4: Headless merge into `mcp.json`

From a clone of this repo (or via published package):

```bash
npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "/absolute/path/to/vault"
```

Merges the `basic-memory` entry without wiping other servers (UTF-8 BOM on `mcp.json` is tolerated). See `CHANGELOG.md` and `docs/troubleshooting.md`.

## Read next

| Topic                                                         | Doc                              |
| ------------------------------------------------------------- | -------------------------------- |
| Manual checks (Inspector, FTS, hybrid)                        | `docs/testing/manual-checks.md`  |
| Common errors (uv, BOM, red MCP, `fetch failed`, `memory://`) | `docs/troubleshooting.md`        |
| Generic agent protocol                                        | `AGENTS.md` (Memory protocol)    |
| Example vault layout                                          | `examples/`                      |

## One-line summary

Configure **MCP** (`mcp.json` + `uv`) so tools exist, keep the **vault** in git, and use **User Rules** so the agent reads `START_HERE` → `MEMORY` → `PROJECTS` and closes out in `SESSION_LOG`.

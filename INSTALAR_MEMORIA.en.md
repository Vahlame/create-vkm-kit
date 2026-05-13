# Install Markdown Memory in Cursor — v3 Kit

> **How to use this file:** Paste it into a new Cursor chat. The agent will read the instructions and execute each step to configure memory on this machine.

---

You are a Cursor agent. Your task is to configure the **Markdown memory v3 system** on this machine. Follow the steps in order, running commands when needed, and report the result of each before moving to the next.

The reference kit is in this repository. If you don't know the clone path, ask the user before starting or use the current working directory.

---

## Step 0 — Verify prerequisites

Check that these programs are installed and accessible:

```bash
node --version          # Must be v20 or higher
uvx --version           # Must respond (not "not recognized")
git --version           # For the vault git
```

- If **Node** is missing: https://nodejs.org/en/download (LTS). On Windows: `winget install OpenJS.NodeJS.LTS`
- If **uv/uvx** is missing: https://docs.astral.sh/uv/getting-started/installation/ (Windows: `winget install astral-sh.uv`)
- After installing, **close and reopen the terminal** to refresh PATH.

Tell the user which tools are missing (if any) and wait for them to install before continuing.

---

## Step 1 — Choose the vault path

Ask the user where they want to store the vault (Markdown notes folder).

Suggested default: `%USERPROFILE%\Documents\cursor-memory-vault` (Windows) / `~/Documents/cursor-memory-vault` (Linux/macOS).

The vault can be a new folder or an existing one. Note the chosen path; we'll call it `<VAULT_PATH>`.

---

## Step 2 — Initialize vault and configure MCP

Run the initializer from **the kit clone** (replace `<KIT_ROOT>` with the actual repo path):

```bash
node "<KIT_ROOT>/packages/create-obsidian-memory/dist/index.js" \
  --non-interactive \
  --vault "<VAULT_PATH>"
```

On Windows (PowerShell), use backtick for line continuation:

```powershell
node "<KIT_ROOT>\packages\create-obsidian-memory\dist\index.js" `
  --non-interactive `
  --vault "<VAULT_PATH>"
```

**What this command does:**
- Creates the vault if it doesn't exist, with the structure `START_HERE.md`, `MEMORY.md`, `SESSION_LOG.md`, `PROJECTS/`, `RULES/`, `KNOWN_FAILURES.md`, `TAGS.md`.
- Adds `.vscode/settings.json` to the vault (reduces Git noise on Windows).
- Merges the `basic-memory` entry into `%USERPROFILE%\.cursor\mcp.json` (Windows) or `~/.cursor/mcp.json` (Linux/macOS) **without deleting** other existing entries.
- Creates an automatic backup of `mcp.json` as `mcp.json.bak`.

If the kit clone is not available and you prefer npm:

```bash
npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "<VAULT_PATH>"
```

Show the command output to the user and confirm no errors. If it says `mcp.json updated` or `merged`, continue.

---

## Step 3 — Verify mcp.json

Show the user the current contents of their `mcp.json` (path depends on OS):

| OS | `mcp.json` path |
|----|----------------|
| Windows | `%USERPROFILE%\.cursor\mcp.json` |
| Linux | `~/.config/Cursor/User/globalStorage/cursor.mcp/mcp.json` |
| macOS | `~/Library/Application Support/Cursor/User/globalStorage/cursor.mcp/mcp.json` |

Confirm that the `basic-memory` entry exists and `BASIC_MEMORY_HOME` points to `<VAULT_PATH>`. Expected:

```json
{
  "mcpServers": {
    "basic-memory": {
      "command": "uvx",
      "args": ["basic-memory", "mcp"],
      "env": {
        "BASIC_MEMORY_HOME": "<VAULT_PATH>"
      }
    }
  }
}
```

If the path in `BASIC_MEMORY_HOME` is wrong, fix it directly in the file.

---

## Step 4 — Paste User Rules in Cursor

Tell the user to open **Cursor → Settings → Rules → User Rules** and paste the following complete block (replacing any previous memory rules from older versions):

```
## Markdown Memory (vault + MCP v3)

**Why:** the model doesn't persist between chats; a git-backed vault is yours, auditable, and portable.

### Don't confuse with Cursor's built-in memory
- `memory://...` resources (toasts or links) are **native IDE memory**, not vault files.
- This memory lives in **Markdown on disk** via vault MCP tools.

### Available MCP
- **`basic-memory`** (always): `read_note`, `write_note`, `edit_note`, `search_notes`, `build_context`, `recent_activity`. Paths are relative to `BASIC_MEMORY_HOME`.
- **`obsidian-memory-hybrid`** (if green): `vault_fts_search` for fast BM25/FTS5 search; `vault_fts_index` after bulk imports. If not active, use `search_notes` from `basic-memory`.
- If **no** vault MCP server responds, say so explicitly; don't claim to have persisted to the vault.

### On startup (any task touching vault context)
1. `read_note("START_HERE.md")` — vault reading order.
2. `read_note("MEMORY.md")` — global preferences and lasting lessons.
3. `read_note("PROJECTS/<project>.md")` where `<project>` matches the short name of the active repo or folder. Create it with `write_note` if it doesn't exist.

### On-demand (only if applicable)
- Project hard rules: `RULES/<project>.md`
- Sprint history: `PROJECTS/<project>/SPRINTS.md`
- Runbook: `PROJECTS/<project>/RUNBOOK.md`
- Failure patterns: `KNOWN_FAILURES.md`
- Tag index: `TAGS.md`

### During the task
- Record relevant decisions in `PROJECTS/<project>.md`.
- Don't store secrets, tokens, JWTs, or literal hardware IDs.
- Checkpoint in `SESSION_LOG.md` only with real progress (every few messages or on close).

### On task close
- Brief entry in `SESSION_LOG.md` (ISO date, project, result or decision).
- Cross-cutting lessons in `MEMORY.md`.
- New project hard rule in `RULES/<project>.md` if applicable.
- Discarded path in `KNOWN_FAILURES.md` with reason.

### Note style
- Short and actionable. Explicitly separate **facts** and **hypotheses**.
- Use wikilinks `[[...]]` to navigate between notes.
- Don't fill the vault with noise: one line per decision, not paragraphs.
```

Ask the user to save and **restart Cursor** (or run `Developer: Reload Window`).

---

## Step 5 — Verify MCP works

After the user restarts Cursor, open a new chat and try reading the vault:

```
read_note("START_HERE.md")
```

If the tool responds with the file contents, the installation is correct. Confirm to the user:

✓ `basic-memory` connected — vault at `<VAULT_PATH>`
✓ MCP tools respond (`read_note`, `write_note`, etc.)
✓ User Rules are active (agent knows how to use the vault)

If it fails, check [`docs/troubleshooting.md`](./docs/troubleshooting.md) section "MCP / Cursor errors".

---

## Step 6 (Optional) — Automatic git sync

If the user wants the vault to sync automatically with GitHub:

1. Ensure there's a git repo in `<VAULT_PATH>` (`git init` if not).
2. Create a private GitHub repo: `gh repo create memory-agents --private --source <VAULT_PATH> --push`
3. For silent automatic sync on Windows (no pop-up windows), build the daemon:

```powershell
# From kit root
go build -ldflags="-H windowsgui" -o bin\obsidian-memoryd.exe .\cmd\obsidian-memoryd
```

4. Create a shortcut in `shell:startup` pointing to `obsidian-memoryd.exe watch --vault "<VAULT_PATH>"`.

Full guide: [`docs/setup/windows-scheduled-vault-sync.md`](./docs/setup/windows-scheduled-vault-sync.md).

---

## Step 7 (Optional) — Advanced search for large vaults (hybrid FTS)

If the vault has hundreds of notes and you want fast BM25 search:

```bash
# 1. Install Python backend (once only)
pip install -e "<KIT_ROOT>/packages/obsidian-memory-rag"

# 2. Add obsidian-memory-hybrid to mcp.json
node "<KIT_ROOT>/packages/create-obsidian-memory/dist/index.js" \
  --non-interactive --vault "<VAULT_PATH>" \
  --with-hybrid --repo-root "<KIT_ROOT>"
```

Restart Cursor. Then use `vault_fts_index` to build the index and `vault_fts_search` to search.

---

## Final summary

When done, confirm status to the user:

| Component | Status |
|---|---|
| Vault created | `<VAULT_PATH>` |
| `basic-memory` in `mcp.json` | ✓ |
| User Rules pasted | ✓ |
| MCP verified | ✓ (or ✗ + instruction) |
| Git sync | Optional |
| Hybrid FTS | Optional |

**Next chat:** the agent will read `START_HERE.md` → `MEMORY.md` → `PROJECTS/<project>.md` at the start of each task.

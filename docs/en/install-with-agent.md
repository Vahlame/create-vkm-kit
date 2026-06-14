> [🇪🇸 Español](../es/instalar-con-agente.md) · 🇬🇧 English

# Install with an agent (paste it into the chat)

This file is an **installer for an agent**: you paste it into a Cursor chat (or Claude Code)
and the agent runs all the steps for you, reporting each one. It's the "hands-free" alternative
to the [manual installation](install.md).

> ## ⚠️ Before pasting this — verify the source
>
> This file **authorizes an agent to act as an installer with your permissions** (it touches
> `~/.cursor/mcp.json`, installs packages, edits git). Treat it like a `curl ... | sh`:
>
> 1. **Read it from your own local clone**, not from a random link (Discord, X, an unreviewed PR).
> 2. At the root of the clone, run `git remote get-url origin` and `git log -1 --format="%H %s"`:
>    `origin` must be `https://github.com/Vahlame/cursor-obsidian-memory-guide.git` (or your
>    legitimate fork) and the commit must match the latest release at
>    <https://github.com/Vahlame/cursor-obsidian-memory-guide/releases/latest>.
> 3. If something doesn't add up, **paste nothing** and open an issue.

---

**Copy from here down and paste it into a new agent chat:**

---

You are a Cursor/Claude Code agent. Your task is to install and **verify** the **Markdown memory**
system on this machine. Follow the steps in order; run the commands and **report the result of each
one** before continuing. If you don't know the path of the kit's clone, ask for it or use the current
working directory; we'll call it `<KIT_ROOT>`.

## Step 0 — Prerequisites

Check that Node 20+, uvx and git exist:

```bash
node --version
uvx --version
git --version
```

If any is missing, tell the user how to install it (Windows: `winget install OpenJS.NodeJS.LTS`,
`winget install astral-sh.uv`) and **wait** for them to reopen the terminal before continuing. Don't
continue with missing tools.

## Step 1 — Vault path

Ask the user where they want the vault. By default:
`%USERPROFILE%\Documents\cursor-memory-vault` (Windows) / `~/Documents/cursor-memory-vault`
(Linux/macOS). Note it as `<VAULT>`.

## Step 2 — Create the vault and connect the MCP

Run the installer from the kit's clone:

```bash
node "<KIT_ROOT>/packages/create-obsidian-memory/src/index.js" --non-interactive --vault "<VAULT>"
```

In PowerShell (Windows), the line break is with `` ` ``:

```powershell
node "<KIT_ROOT>\packages\create-obsidian-memory\src\index.js" `
  --non-interactive `
  --vault "<VAULT>"
```

If no clone is available, use npm: `npx @vahlame/create-obsidian-memory -- --non-interactive --vault "<VAULT>"`.

**What it does:** creates the vault if it doesn't exist (`START_HERE.md`, `MEMORY.md`, `SESSION_LOG.md`,
`PROJECTS/`), merges `basic-memory` into `mcp.json` **without deleting** other entries, makes a backup
`mcp.json.bak.<date>`, and writes `<VAULT>/.vscode/settings.json`. Show the output and confirm
there were no errors.

## Step 3 — Verify `mcp.json`

Show the user the `basic-memory` entry of their `mcp.json` (Windows: `%USERPROFILE%\.cursor\mcp.json`).
Confirm that `BASIC_MEMORY_HOME` points to `<VAULT>` and that the args include the pin
`--from "basic-memory==0.21.4"` (supply-chain security). If the path is wrong, fix it.

## Step 4 — User Rules

Open [`docs/en/install.md`](install.md) in `<KIT_ROOT>`, copy **the whole User Rules block from
Step 4** and show it to the user so they paste it into
**Cursor → Settings → Rules → User Rules** (it's the single source; don't rewrite it from memory).
Ask them to save and do **Developer: Reload Window**.

## Step 5 — Test end to end

After the restart, in a new chat try to read a note from the vault (e.g. `read_note("START_HERE.md")`).
If it responds with the contents, the installation is correct. Confirm to the user:

- ✅ `basic-memory` connected (vault at `<VAULT>`)
- ✅ The MCP tools respond
- ✅ User Rules active

If it fails, check [`docs/en/troubleshooting.md`](troubleshooting.md) → section **MCP / Cursor**.

## Step 6 (optional) — Git syncing

If the user wants a backup / multi-machine, offer it and follow
[`docs/en/sync.md`](sync.md) (the `obsidian-memoryd` daemon, manual git, or same
repo). For Windows without windows: build with `go build -ldflags="-H windowsgui" -o bin/obsidian-memoryd.exe ./cmd/obsidian-memoryd`
and create a shortcut in `shell:startup` to `obsidian-memoryd watch --vault "<VAULT>"`. Daemon
health: `obsidian-memoryd doctor`.

## Step 7 (optional) — Hybrid search (large vaults)

If the vault is large and word- and meaning-based search is wanted:

```bash
pip install -e "<KIT_ROOT>/packages/obsidian-memory-rag"
node "<KIT_ROOT>/packages/create-obsidian-memory/src/index.js" \
  --non-interactive --vault "<VAULT>" --with-hybrid --repo-root "<KIT_ROOT>"
```

Restart Cursor. Build the index with `vault_fts_index` (use `semantic: true` for the
vectors) and search with `vault_hybrid_search`.

## Final summary

Report a status table: vault created (`<VAULT>`), `basic-memory` in `mcp.json` (✓), User
Rules pasted (✓), MCP verified (✓/✗ + instruction), git sync (optional), hybrid (optional).
Remind them that in the next chat the agent will read `START_HERE.md` → `MEMORY.md` →
`PROJECTS/<project>.md` at the start of each task.

---

— end of the block to paste —

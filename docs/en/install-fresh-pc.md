> [🇪🇸 Español](../es/instalar-pc-nueva.md) · 🇬🇧 English

# Install on a fresh PC (Claude Code)

Reproduce your **whole** memory on a freshly wiped machine: the notes, the MCP, semantic search,
and the token-saving rules. Two paths; both end the same.

> For **Cursor** (not Claude Code) the path is the `npx` initializer — see
> [`install.md`](install.md). This page is **Claude Code**-specific because its MCP is registered
> with `claude mcp …`, not an `mcp.json` file.

## The only things you do by hand (can't be bootstrapped from nothing)

1. **Install Claude Code** on the new PC (it can't bootstrap itself).
2. **Have access to your private vault repo** (your GitHub account, logged in).

Everything else is automated by one of the two paths.

---

## Path A — the agent installs it (minimal assistance) ⭐

Open Claude Code on the new PC and **paste the block below** into a new chat. The agent checks
prerequisites, clones, registers the MCP, builds the index, and verifies. You just **approve**
the commands.

> ⚠️ Like `curl … | sh`: this block authorizes an agent to install software and edit your config.
> Only paste it from a source you trust (this repo).

**Copy from here down:**

---

You are a Claude Code agent. Install the **Markdown memory system** on this fresh PC. Run each
step, **report the result**, and ask for approval before commands that install software.
Variables: `<KIT>` = where you'll clone the kit; `<VAULT>` = vault path; `<VAULT_GIT_URL>` = the
private notes repo URL (ask me if you don't have it).

1. **Prerequisites.** Check `node --version` (≥20), `uvx --version`, `python --version` (≥3.11),
   `git --version`. Install what's missing (Windows: `winget install OpenJS.NodeJS.LTS`,
   `winget install astral-sh.uv`, `winget install Python.Python.3.12`, `winget install Git.Git`;
   macOS: `brew install node uv python git`). Tell me and **reopen the terminal** after installing.
2. **Clone the kit:** `git clone https://github.com/Vahlame/cursor-obsidian-memory-guide "<KIT>"`.
3. **Clone the vault:** `git clone "<VAULT_GIT_URL>" "<VAULT>"` (ask me for the private URL).
4. **Python backend + semantic:** `pip install -e "<KIT>/packages/obsidian-memory-rag[semantic]"`.
5. **Register the MCP in Claude Code (scope `user` = all chats).** If a server already exists,
   first `claude mcp remove <name> -s user`. Then:

   ```bash
   claude mcp add basic-memory -s user \
     -e BASIC_MEMORY_HOME="<VAULT>" \
     -- uvx --from basic-memory==0.21.4 basic-memory mcp

   claude mcp add obsidian-memory-hybrid -s user \
     -e BASIC_MEMORY_HOME="<VAULT>" \
     -e PYTHONPATH="<KIT>/packages/obsidian-memory-rag/src" \
     -e PYTHONUTF8=1 \
     -e OBSIDIAN_MEMORY_EMBEDDER="fastembed:sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2" \
     -- node "<KIT>/packages/obsidian-memory-mcp/src/hybrid-mcp.mjs"
   ```

6. **Build the index (with semantic vectors):**

   ```bash
   PYTHONPATH="<KIT>/packages/obsidian-memory-rag/src" python -m obsidian_memory_rag index \
     --vault "<VAULT>" --semantic \
     --embedder "fastembed:sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
   ```

7. **Global rules (passage-first + savings).** Open `<KIT>/docs/en/install.md`, copy the **User
   Rules block from Step 4**, and paste/append it into `~/.claude/CLAUDE.md` (Claude Code loads it
   every session). If I already have a global `CLAUDE.md`, integrate without deleting mine.
8. **(Optional) git sync** of the vault: see `<KIT>/docs/en/sync.md`.
9. **Verify:** `claude mcp list` must show `basic-memory` and `obsidian-memory-hybrid` as
   **✓ Connected**. Restart Claude Code. In a new chat, a `vault_hybrid_search` must return a
   **passage** (not the whole note). Report a final status table.

— end of the block to paste —

---

## Path B — manual commands (repeatable)

Same steps, no agent. Replace `<KIT>`, `<VAULT>`, `<VAULT_GIT_URL>` with your paths/URL.

```bash
# 0) Prerequisites (Windows example; macOS: brew install node uv python git)
winget install OpenJS.NodeJS.LTS astral-sh.uv Python.Python.3.12 Git.Git
#    close and reopen the terminal to refresh PATH

# 1-3) Clone kit + vault, install the semantic backend
git clone https://github.com/Vahlame/cursor-obsidian-memory-guide "<KIT>"
git clone "<VAULT_GIT_URL>" "<VAULT>"
pip install -e "<KIT>/packages/obsidian-memory-rag[semantic]"

# 4) Register MCP in Claude Code (user scope). If they exist: claude mcp remove <name> -s user
claude mcp add basic-memory -s user -e BASIC_MEMORY_HOME="<VAULT>" -- uvx --from basic-memory==0.21.4 basic-memory mcp
claude mcp add obsidian-memory-hybrid -s user -e BASIC_MEMORY_HOME="<VAULT>" -e PYTHONPATH="<KIT>/packages/obsidian-memory-rag/src" -e PYTHONUTF8=1 -e OBSIDIAN_MEMORY_EMBEDDER="fastembed:sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2" -- node "<KIT>/packages/obsidian-memory-mcp/src/hybrid-mcp.mjs"

# 5) Semantic index
PYTHONPATH="<KIT>/packages/obsidian-memory-rag/src" python -m obsidian_memory_rag index --vault "<VAULT>" --semantic --embedder "fastembed:sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

# 6) Verify
claude mcp list   # both ✓ Connected
```

Then copy the User Rules block ([install Step 4](install.md#step-4--paste-the-user-rules-into-cursor)) into `~/.claude/CLAUDE.md` and **restart Claude Code**.

---

## What you do NOT copy

- **The `.obsidian-memory-rag/` index** — gitignored on purpose (regenerable binary). That's why
  step 5 rebuilds it on each PC.
- **`fastembed` / the model** — installed via the `[semantic]` extra (step 4); the model downloads
  itself the first time it's used.

## Quick check

| Check                           | Expected                                                  |
| ------------------------------- | --------------------------------------------------------- |
| `claude mcp list`               | `basic-memory` and `obsidian-memory-hybrid` → ✓ Connected |
| `vault_hybrid_search` in a chat | returns **heading + section**, with `_trust`              |
| `vault_audit`                   | health JSON (oversized, links, SESSION_LOG)               |

If something fails → [`troubleshooting.md`](troubleshooting.md).

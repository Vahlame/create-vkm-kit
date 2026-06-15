> [🇪🇸 Español](../es/instalar-con-agente.md) · 🇬🇧 English

# Install with an agent (paste it into the chat)

Don't want to follow the [manual guide](install.md)? Paste the block below into a **Cursor** or
**Claude Code** chat: the agent installs and verifies everything, and you just **approve the
commands**. Works for both IDEs — no clone needed for the basic install.

> ## ⚠️ Before pasting — this is a `curl … | sh`-class action
>
> The block authorizes an agent to install an npm package, edit your MCP config, and touch git.
> Paste it **only from this repo** (<https://github.com/Vahlame/obsidian-memory-kit>) and check the
> package it installs is **`@vkmikc/create-obsidian-memory`**. If anything looks off, paste nothing
> and open an issue.

---

**Copy from here down into a new agent chat:**

---

You are a Cursor or Claude Code agent. Install and **verify** the **Markdown memory** system on
this machine. Run each command, **report its result**, and ask for approval before anything that
installs software.

**1 · Prerequisites.** These must exist; install whatever is missing, then have me reopen the
terminal so `PATH` refreshes:

```bash
node --version   # ≥ 20
uvx --version    # any — runs the basic-memory MCP
git --version    # any
```

> Windows: `winget install OpenJS.NodeJS.LTS astral-sh.uv Git.Git` · macOS: `brew install node uv git`.

**2 · Install — one command.** Ask me for the vault folder (default
`~/Documents/obsidian-memory-vault`, on Windows `%USERPROFILE%\Documents\obsidian-memory-vault`);
call it `<VAULT>`. Run the line matching the IDE you're running in — ask me if you're unsure:

```bash
# Cursor
npx @vkmikc/create-obsidian-memory "<VAULT>" -y --rules all

# Claude Code  (registers via `claude mcp add`, not mcp.json)
npx @vkmikc/create-obsidian-memory "<VAULT>" -y --ide claude --rules all
```

One command does it all: creates the vault if missing (`START_HERE.md`, `MEMORY.md`,
`SESSION_LOG.md`, `PROJECTS/`), wires the version-pinned **`basic-memory`** MCP (backing up any
existing config first), and installs the memory **User Rules** as an idempotent marked block in
`~/.claude/CLAUDE.md`, `./AGENTS.md` and `.cursor/rules/` (never clobbers your content). Show the
output and confirm there were no errors.

**3 · Cursor global rules (Cursor only).** Step 2 already wrote the _project_ rule
(`.cursor/rules/obsidian-memory.mdc`). For _global_ coverage, show me the marked block (between
the `obsidian-memory:start`/`end` markers) and tell me to paste it into
**Cursor → Settings → Rules → User Rules** — Cursor keeps global rules outside any file.
**Claude Code: skip this** — `~/.claude/CLAUDE.md` is already done.

**4 · Restart & verify.** Tell me to run **Developer: Reload Window** (Cursor) or restart Claude
Code. Then, in a new chat, prove it works:

```text
Read START_HERE.md from my vault and tell me what it contains.
```

If the contents come back, report a status table — vault (`<VAULT>`) ✓ · MCP connected ✓ · rules
installed ✓ · read test ✓. If it fails, see [`troubleshooting.md`](troubleshooting.md) →
**MCP / Cursor**.

**5 · (Optional) Hybrid search — large vaults only.** Search by word **and** meaning needs the kit
**cloned** and Python ≥ 3.11. Ask me for a clone path `<KIT>`, then:

```bash
git clone https://github.com/Vahlame/obsidian-memory-kit "<KIT>"
pip install -e "<KIT>/packages/obsidian-memory-rag[semantic]"
node "<KIT>/packages/create-obsidian-memory/src/index.js" -y --vault "<VAULT>" --with-hybrid --semantic --build-index --repo-root "<KIT>"
```

On Claude Code add `--ide claude` to the last line. Restart the IDE; the `obsidian-memory-hybrid`
tools (`vault_hybrid_search`, …) then respond.

---

— end of the block to paste —

> Setting up a **whole fresh machine** (clone your private vault repo, global `CLAUDE.md`, and the
> semantic index in one go)? Use [`install-fresh-pc.md`](install-fresh-pc.md) instead.

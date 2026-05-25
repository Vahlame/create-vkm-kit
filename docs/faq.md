# FAQ

## Questions

### Why not use Cursor's built-in "memories" feature?

Cursor's built-in memories are tied to Cursor's account and storage, are not portable, and you cannot read or edit them outside Cursor. This pattern gives you a Markdown vault you own, in a private GitHub repo, that you can read or edit in any editor, sync across machines, and grep with normal tools. See `docs/comparison.md` for the full comparison. **First-time path:** `GETTING_STARTED.md` (linear) and `docs/how-memory-works-simple.md` (plain-language model).

### Is this safe to paste into Cursor?

**v1:** the archived ultra-prompt instructs an agent to execute code on your machine (packages, `%USERPROFILE%`, scheduled tasks, git push). Treat it like an installer: pin releases, read diffs, verify the source URL. **v3 kit:** you configure MCP via the `create-obsidian-memory` initializer + optional daemon; `SECURITY.md` still applies. See also `docs/security/mcp-remote-rce.md` if you bridge remote MCP.

### What does it cost?

Nothing. You pay for whatever Cursor plan you already have, plus a private GitHub repository (free on personal accounts).

### Will it work without internet?

Local memory works. Sync to GitHub does not. **v1 (Windows):** the watchdog kept an SSE MCP process up; autosync retried on a timer. **v3 kit:** `basic-memory` runs with the IDE session (`uvx`); optional **`obsidian-memoryd watch`** debounces git sync and will fail push/pull until the network returns, then catch up on the next debounced cycle.

### Why a private repo?

Your memory may include client names, internal architectures, half-formed ideas, and links you do not want public. A private repo is the default safety setting.

### Can multiple machines write at the same time?

Yes, with caveats. The autosync uses `git pull --rebase`, which handles non-overlapping edits correctly. If two machines edit the same line of `MEMORY.md` before the next sync runs, you will get a Git conflict on the next sync. The task will fail and the conflict will appear in `git status` for you to resolve manually. This is rare in practice because the agent appends rather than overwrites. Prefer **longer** scheduler intervals (the kit defaults to **60 minutes** in `windows-scheduled-vault-sync*.md`) so you are not hammering the remote.

### Does it slow Cursor down?

No meaningful slowdown for normal vault sizes. The MCP server runs out of process; calls are loopback-fast. **Very large vaults:** add the optional **`obsidian-memory-rag`** FTS5 index (`index` / `search`) so retrieval stays snappy without scanning everything on every question.

### Can I rename `MEMORY.md` or `SESSION_LOG.md`?

You can, but you would have to change your **User Rules** (and any scripts that hard-code the names) accordingly. The names are convention, not protocol. Edit the pasted User Rules block in `docs/cursor-memory-setup.md` / `.en.md` to match your filenames.

### How do I uninstall?

**v3 kit:** remove the **`basic-memory`** entry (or rename the server) from your IDE MCP config (`%USERPROFILE%\.cursor\mcp.json`), stop **`obsidian-memoryd`** if you installed it (kill process / remove Startup shortcut), and delete local sidecar data under **`<vault>/.obsidian-memory-rag/`** if you no longer want the FTS index. Your Markdown vault remains yours. **v1 (Windows):** `docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md` section 8 describes `Uninstall-Cursor-Memory.ps1` (scheduled tasks + `mcp.json.bak`).

### Why Windows-first?

The maintainer's first end-to-end install was Windows (ADR-0007). The **v3 kit** is **cross-platform**; the repo ships Linux/macOS pointers at `PROMPT_ULTRA_COMPLETO.linux.md` and `PROMPT_ULTRA_COMPLETO.macos.md` (short redirects) plus the Go daemon for non-Windows sync.

### Will this work on Cursor Web / cursor.com?

Generally **no** for the same reason as any localhost MCP: the web UI cannot reach processes on your machine. **v1** assumed SSE on `127.0.0.1:3001`. **v2** defaults to **`uvx basic-memory mcp`** (local child process); some Streamable HTTP setups are still “local machine + IDE” bound—treat web Cursor as unsupported unless your vendor documents a supported bridge.

### Will this work with Claude Desktop, Continue, or other MCP-capable clients?

In principle yes. They consume the same MCP server. You would have to translate the User Rules and the `mcp.json` block (see `docs/cursor-memory-setup.*`) to that client's equivalent config. The vault files are unchanged.

### How big can the vault get before it's a problem?

In practice multiple hundreds of MB are fine. Both v1 and v3 kit push small git diffs; the optional **`obsidian-memory-rag`** FTS5 index keeps search fast at any size. Reading `MEMORY.md` is bounded by model context because the agent reads only what it needs.

### Can I share `MEMORY.md` with a teammate?

Yes. Invite them to the private repo. **v1:** they re-ran the ultra-prompt once. **v3 kit:** they run `create-obsidian-memory` to merge the same MCP config + clone the vault; use normal git conflict habits if two people edit the same line.

### How do I update to a new version of the prompt?

**v3 kit:** `git pull` this repo for docs and tooling; bump **`@vahlame/create-obsidian-memory`** if you use the initializer; refresh MCP pins if `CHANGELOG.md` / `SECURITY.md` say so. Re-run `create-obsidian-memory --non-interactive --vault "<path>"` to re-merge a clean config. **v1:** pull the tag, re-paste the ultra-prompt; idempotent on scripts and `mcp.json`. Your vault stays separate.

### Large vault: anything beyond `basic-memory` search?

Yes. Activate the **hybrid MCP** via the initializer: `node packages/create-obsidian-memory/src/index.js --non-interactive --vault "<path>" --with-hybrid --repo-root "<kit-clone>"` (needs `pip install -e packages/obsidian-memory-rag` once). Then run **`obsidian-memory-rag index --vault <path>`** (or use the `vault_fts_index` MCP tool) to build a local **SQLite FTS5** index; `vault_fts_search` returns BM25-ranked hits. See `docs/testing/manual-checks.md` for smoke tests.

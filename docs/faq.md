# FAQ

## Questions

### Why not use Cursor's built-in "memories" feature?

Cursor's built-in memories are tied to Cursor's account and storage, are not portable, and you cannot read or edit them outside Cursor. This pattern gives you a Markdown vault you own, in a private GitHub repo, that you can read or edit in any editor, sync across machines, and grep with normal tools. See `docs/comparison.md` for the full comparison. **First-time path:** `GETTING_STARTED.md` (linear) and `docs/how-memory-works-simple.md` (plain-language model).

### Is installing this safe?

You configure MCP via the `create-obsidian-memory` initializer (or by hand) and optionally install the Go daemon. Anything agent-driven runs with your privileges — writes to `~/.cursor/mcp.json`, installs background daemons, edits git config — so treat it like an installer: verify the clone source, pin releases, read diffs. `SECURITY.md` covers the trust model; `docs/security/mcp-remote-rce.md` applies if you bridge a remote MCP.

### Installing it is just pasting a prompt, right?

No. That is exactly what this kit is **not**. Setting up the memory means configuring an MCP server against a vault, optionally building the Python FTS/semantic index, and optionally running the Go sync daemon. `GETTING_STARTED.md` walks each step.

### What does it cost?

Nothing. You pay for whatever Cursor plan you already have, plus a private GitHub repository (free on personal accounts).

### Will it work without internet?

Local memory works. Sync to GitHub does not. `basic-memory` runs with the IDE session (`uvx`); optional **`obsidian-memoryd watch`** debounces git sync and will fail push/pull until the network returns, then catch up on the next debounced cycle.

### Why a private repo?

Your memory may include client names, internal architectures, half-formed ideas, and links you do not want public. A private repo is the default safety setting.

### Can multiple machines write at the same time?

Yes, with caveats. Sync uses `git pull --rebase`, which handles non-overlapping edits correctly. If two machines edit the same line of `MEMORY.md` before the next sync runs, you get a Git conflict to resolve manually. This is rare because the agent appends rather than overwrites. Prefer **longer** sync intervals (the daemon defaults to a 45 s debounce; scheduled-task guides default to 60 minutes) so you are not hammering the remote.

### Does it slow Cursor down?

No meaningful slowdown for normal vault sizes. The MCP server runs out of process; calls are loopback-fast. **Very large vaults:** add the optional **`obsidian-memory-rag`** index so retrieval (`vault_fts_search` / `vault_hybrid_search`) stays snappy without scanning everything on every question.

### Can I search by meaning, not just exact keywords?

Yes — that is what **`vault_hybrid_search`** does. It fuses lexical BM25 (FTS5) with **semantic** vector similarity (Reciprocal Rank Fusion), so a query like _"el daemon que sincroniza git"_ finds the right note even without those exact words. The default embedder is dependency-free (lexical); for true synonym matching install the `[semantic]` extra and set `OBSIDIAN_MEMORY_EMBEDDER=fastembed:<model>`, then build vectors with `vault_fts_index({ semantic: true })`. See ADR-0017.

### Does the hybrid search actually save tokens?

For known projects, yes. Search returns the matching **chunk** (a heading + a few-hundred-character passage), not the whole note, so the agent usually answers without a follow-up full-file read. On a large note that is the difference between reading a passage (~hundreds of tokens) and an 8 KB file (~thousands). The fixed overhead is the session's tool schemas + the startup index injection; one or two retrievals on real notes recover it. See `docs/benchmarks/retrieval.md`.

### Can I rename `MEMORY.md` or `SESSION_LOG.md`?

You can, but you would have to change your **User Rules** (and any scripts that hard-code the names) accordingly. The names are convention, not protocol. Edit the pasted User Rules block in `docs/cursor-memory-setup.md` to match your filenames.

### How do I uninstall?

Remove the **`basic-memory`** entry (or rename the server) from your IDE MCP config (`%USERPROFILE%\.cursor\mcp.json`), stop **`obsidian-memoryd`** if you installed it (kill the process / remove the Startup shortcut), and delete local sidecar data under **`<vault>/.obsidian-memory-rag/`** if you no longer want the index. Your Markdown vault remains yours.

### Why Windows-first?

The maintainer's first end-to-end install was Windows (ADR-0007). The kit is now **cross-platform**, with the Go daemon (`cmd/obsidian-memoryd`) handling non-Windows sync.

### Will this work on Cursor Web / cursor.com?

Generally **no**, for the same reason as any localhost MCP: the web UI cannot reach processes on your machine. The default is **`uvx basic-memory mcp`** (a local child process); some Streamable HTTP setups are still "local machine + IDE" bound. Treat web Cursor as unsupported unless your vendor documents a supported bridge.

### Will this work with Claude Desktop, Continue, or other MCP-capable clients?

In principle yes. They consume the same MCP server. You would translate the User Rules and the `mcp.json` block (see `docs/cursor-memory-setup.md`) to that client's equivalent config. The vault files are unchanged.

### How big can the vault get before it's a problem?

In practice multiple hundreds of MB are fine. Git diffs stay small; the optional **`obsidian-memory-rag`** index (FTS5 + chunk vectors) keeps search fast at any size. Reading `MEMORY.md` is bounded by model context because the agent reads only what it needs.

### Can I share `MEMORY.md` with a teammate?

Yes. Invite them to the private repo. They run `create-obsidian-memory` to merge the same MCP config + clone the vault; use normal git conflict habits if two people edit the same line.

### How do I update?

`git pull` this repo for docs and tooling; bump **`@vahlame/create-obsidian-memory`** if you use the initializer; refresh MCP pins if `CHANGELOG.md` / `SECURITY.md` say so. Re-run `create-obsidian-memory --non-interactive --vault "<path>"` to re-merge a clean config. Your vault stays separate.

### Large vault: anything beyond `basic-memory` search?

Yes. Activate the **hybrid MCP** via the initializer: `node packages/create-obsidian-memory/src/index.js --non-interactive --vault "<path>" --with-hybrid --repo-root "<kit-clone>"` (needs `pip install -e packages/obsidian-memory-rag` once). Build the index with **`obsidian-memory-rag index --vault <path> --semantic`** (or the `vault_fts_index` MCP tool with `semantic: true`). Then `vault_fts_search` returns BM25 hits and `vault_hybrid_search` returns relevance-ranked BM25 + semantic passages. See `docs/testing/manual-checks.md` for smoke tests.

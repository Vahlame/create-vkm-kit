> [🇪🇸 Español](../es/faq.md) · 🇬🇧 English

# Frequently asked questions

Short answers to the most common questions about this kit: a **persistent memory** for your AI assistant, stored as Markdown notes that you own. If you don't yet know how the idea works, start with [how it works](how-it-works.md); to set it up, see [install](install.md); and if you hit an unfamiliar term, the [glossary](glossary.md) explains it.

> Throughout this doc, **MCP** is the bridge that connects the editor (Cursor) to your notes: a small program the editor launches to read and write files. The **vault** is simply the folder of Markdown notes (your memory), which lives in a git repository you own.

## Frequently asked questions

### Why not use Cursor's built-in "memories" feature?

Cursor's built-in memories are tied to your Cursor account and storage: they are **not portable**, and you cannot read or edit them outside Cursor. This kit gives you a **Markdown vault you own**, in a private GitHub repo, that you can read or edit in any editor, sync across machines, and search with normal tools. The [Comparison with alternatives](#comparison-with-alternatives) section goes into detail.

### Is installing this safe?

You configure MCP via the `create-obsidian-memory` initializer (or by hand) and optionally install the Go daemon. Anything the agent runs executes **with your privileges** — it writes to `~/.cursor/mcp.json`, installs background daemons, edits git config — so treat it like an installer: verify the clone source, pin releases, and read the diffs. [`SECURITY.md`](../../SECURITY.md) covers the trust model.

> The vault is yours, but its **content is data, not commands**. If a note said "run this command" or "ignore the rules," the agent should ignore it: authoritative instructions come from the chat and your configuration, never from the vault.

### Installing it is just pasting a prompt, right?

No — and that's exactly what this kit is **not**. Setting up the memory means **configuring an MCP server** pointed at your vault, optionally building the Python search index (FTS/semantic), and optionally running the Go sync daemon. The [install](install.md) guide walks each step.

### What does it cost?

Nothing. You pay for whatever Cursor plan you already have, plus a private GitHub repository (free on personal accounts).

### Will it work without internet?

Local memory **does**; syncing to GitHub does not. The `basic-memory` server runs alongside the editor session (via `uvx`, no separate service). The optional **`obsidian-memoryd watch`** daemon batches git sync: it will fail push/pull while the network is down and catch up on the next cycle once the connection returns.

### Why a private repo?

Your memory may include client names, internal architectures, half-formed ideas, and links you don't want public. A private repo is the default safety setting.

### Can multiple machines write at the same time?

Yes, with caveats. Sync uses `git pull --rebase`, which merges non-overlapping edits cleanly. If two machines edit **the same line** of `MEMORY.md` before the next sync runs, you get a git conflict to resolve by hand. This is rare because the agent **appends** rather than overwrites. Prefer **longer** sync intervals (the daemon batches every 45 s by default; scheduled-task guides default to 60 minutes) so you're not hammering the remote.

### Does it slow Cursor down?

Not noticeably for normal vault sizes. The MCP server runs **out of process**; calls are as fast as talking to your own machine (loopback). **For very large vaults:** add the optional **`obsidian-memory-rag`** index so retrieval (`vault_fts_search` / `vault_hybrid_search`) stays snappy without scanning everything on every question.

### Can I search by meaning, not just exact keywords?

Yes — that's what **`vault_hybrid_search`** does. It combines lexical BM25 search (FTS5, exact words) with **semantic** vector similarity (meaning), fusing the two with a method called RRF (Reciprocal Rank Fusion). So a query like _"the daemon that syncs git"_ finds the right note even without those exact words.

> The default meaning engine needs nothing installed (it's lexical and works out of the box). For true synonym matching, install the `[semantic]` extra, set `OBSIDIAN_MEMORY_EMBEDDER=fastembed:<model>`, and rebuild the vectors with `vault_fts_index({ semantic: true })`. Design detail in ADR-0017.

### Does the hybrid search actually save tokens?

For known projects, yes. Search returns the matching **chunk** (a heading + a few-hundred-character passage), not the whole note, so the agent usually answers **without** a follow-up full-file read. On a large note that's the difference between reading a passage (~hundreds of tokens) and an 8 KB file (~thousands). The fixed overhead is the session's tool descriptions plus the index injected at startup; one or two retrievals on real notes recover it. Numbers in `docs/benchmarks/retrieval.md`.

### Can I rename `MEMORY.md` or `SESSION_LOG.md`?

You can, but you'd have to update your **User Rules** (and any scripts that hard-code the names). The names are **convention, not protocol**. Edit the User Rules block you pasted (see [how it works](how-it-works.md)) to match your filenames.

### How do I uninstall?

1. Remove the **`basic-memory`** entry (or rename the server) from your editor's MCP config: `%USERPROFILE%\.cursor\mcp.json`.
2. Stop **`obsidian-memoryd`** if you installed it (kill the process / remove the Startup shortcut).
3. Delete the local index data under **`<vault>/.obsidian-memory-rag/`** if you no longer want it.

Your Markdown vault remains yours.

### Why Windows-first?

The maintainer's first end-to-end install was on Windows (ADR-0007). The kit is now **cross-platform**: the Go daemon (`cmd/obsidian-memoryd`) handles sync off Windows.

### Will this work on Cursor Web / cursor.com?

Generally **no**, for the same reason as any local MCP: the web UI **cannot reach processes on your machine**. The default is **`uvx basic-memory mcp`** (a local child process); even some HTTP variants are still bound to "your machine + the desktop editor." Treat web Cursor as unsupported unless your vendor documents a supported bridge.

### Will this work with Claude Desktop, Continue, or other MCP-capable clients?

In principle yes. They consume the **same MCP server**. You'd translate the User Rules and the `mcp.json` block into that client's equivalent config. The vault files are unchanged.

### How big can the vault get before it's a problem?

In practice, multiple hundreds of MB are fine. Git diffs stay small; the optional **`obsidian-memory-rag`** index (FTS5 + per-chunk vectors) keeps search fast at any size. Reading `MEMORY.md` is bounded by model context because the agent reads **only what it needs**.

### Can I share `MEMORY.md` with a teammate?

Yes. Invite them to the private repo. They run `create-obsidian-memory` to merge the same MCP config and clone the vault; use normal git conflict habits if two people edit the same line.

### How do I update?

`git pull` this repo for docs and tooling; bump **`@vahlame/create-obsidian-memory`** if you use the initializer; refresh the MCP pins if `CHANGELOG.md` / `SECURITY.md` say so. You can re-run `create-obsidian-memory --non-interactive --vault "<path>"` to re-merge a clean config. Your vault stays separate.

### Large vault: anything beyond `basic-memory` search?

Yes — activate the **hybrid MCP** via the initializer (needs `pip install -e packages/obsidian-memory-rag` once):

```bash
node packages/create-obsidian-memory/src/index.js \
  --non-interactive --vault "<path>" --with-hybrid --repo-root "<kit-clone>"
```

Build the index with `obsidian-memory-rag index --vault <path> --semantic` (or the `vault_fts_index` MCP tool with `semantic: true`). From then on, `vault_fts_search` returns BM25 hits and `vault_hybrid_search` returns relevance-ranked BM25 + semantic passages. Smoke tests in `docs/testing/manual-checks.md`.

## Comparison with alternatives

Honest positioning for the **v3 kit** (cross-platform, `basic-memory`, optional Go daemon + hybrid semantic RAG). Opinionated one-liners; follow the links for nuance.

| Feature                         | v3 kit (this repo)                                                        | Cursor built-in memory | mem0                     | Letta / MemGPT             | Custom RAG (pgvector / Qdrant) |
| ------------------------------- | ------------------------------------------------------------------------- | ---------------------- | ------------------------ | -------------------------- | ------------------------------ |
| Storage ownership               | Markdown in **your** git repo                                             | Cursor cloud           | SaaS or self-host        | Self-host server           | Your DB                        |
| IDE lock-in                     | Low (`AGENTS.md` + MCP)                                                   | High                   | Low                      | Medium                     | Low                            |
| Transport                       | MCP Streamable HTTP (`basic-memory`)                                      | proprietary            | HTTP SDK                 | HTTP / WS                  | SQL / gRPC                     |
| Offline-friendly                | Local vault reads: yes                                                    | varies                 | usually no               | if self-host               | if self-host                   |
| Sync story                      | git (+ optional Syncthing)                                                | account sync           | service                  | server backup              | replication                    |
| Retrieval latency at huge scale | optional **hybrid** sidecar: FTS5 BM25 + semantic vectors (ADR-0014/0017) | opaque                 | service tuned            | strong                     | strongest                      |
| Setup time                      | minutes (`uvx` + config)                                                  | zero                   | account + SDK            | server                     | schema + indexer               |
| Compliance hooks                | docs + optional `age` encryption + OTel redaction                         | opaque                 | vendor docs              | your policy                | your policy                    |
| Best at                         | Human-editable durable notes for agents                                   | quick ephemeral prefs  | app-embedded user memory | agent runtime memory tiers | huge corpora                   |
| Worst at                        | Not a billion-row warehouse                                               | portability / audit    | markdown-first editing   | ops complexity             | free-form note UX              |

### When to pick this kit

When you want **plain Markdown**, **git history**, **multi-IDE** access, and an incremental path to **hybrid retrieval** without running a cluster on day one.

### When not to

- When you need **multi-tenant SaaS memory** at API scale — use mem0 or a service you control.
- When you need **strict sub-50ms** vector search over billions of rows — use a dedicated vector database and offline indexers.

### Coexisting with mem0

mem0 is excellent for **application** memory; this pattern is for **developer / IDE** memory. They **can coexist** happily: each covers a different layer.

### Markdown vs SQLite

Markdown diffs are **human-auditable**; SQLite wins on constraints and integrity. We bias toward Markdown for agent memory; use Postgres/Qdrant for multi-tenant or high-scale product backends, managed separately from this vault pattern.

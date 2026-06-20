# @vkmikc/create-obsidian-memory

Interactive initializer for **Obsidian-style, file-based agent memory** — a Markdown vault your
AI coding agent reads and writes across sessions, wired to your IDE over **MCP**.

It configures the [`basic-memory`](https://github.com/basicmachines-co/basic-memory) MCP server
(and, optionally, the `obsidian-memory-hybrid` retrieval sidecar — **BM25 + semantic + graph-aware**
search with opt-in precision levers (**cross-encoder reranker**, type-weighted graph, importance,
MMR diversification, passage-window), a **structured knowledge graph** (typed relations + categorized
observations), **memory reports** for hygiene, and an optional **sqlite-vec** acceleration) for
**Codex CLI**, **Claude Code** and/or **Cursor**, points it at your vault, and can build the local
search index — in one
command. `--full` turns **all** of it on by default.

Part of the [obsidian-memory-kit](https://github.com/Vahlame/obsidian-memory-kit)
kit. Full docs (English + Spanish), architecture and ADRs live there.

## Quick start

```bash
# Interactive wizard (pre-selects everything)
npm create @vkmikc/obsidian-memory@latest

# ⚡ The whole stack, zero questions — vault defaults to ~/Documents/obsidian-memory-vault.
# FULL by default (hybrid + semantic + sqlite-vec + index + rules). Run from a clone of
# the kit (or add --repo-root <clone>) for the hybrid pieces; degrades to basic-memory otherwise.
npx @vkmikc/create-obsidian-memory@latest -y

# …or point it at any folder (created if it doesn't exist)
npx @vkmikc/create-obsidian-memory@latest ./my-vault -y

# Just plain basic-memory, nothing else:
npx @vkmikc/create-obsidian-memory@latest ./my-vault -y --minimal
```

**The install is the full stack BY DEFAULT (v3.8.1)** — hybrid + semantic + sqlite-vec + index +
rules, the same set `--full` ships. That wires the knowledge graph + memory reports (automatic once
hybrid is on), neural embeddings, and the sqlite-vec acceleration. Run it from a clone of the kit (or
pass `--repo-root <clone>`) to get the hybrid pieces; with no clone it **degrades to `basic-memory`
instead of aborting**, so a bare `npx` is always safe. `--full` (alias `--all`) is the same full stack
but also flips `--ide` to `codex,claude`. Use **`--minimal`** for plain `basic-memory`, or
`--no-<piece>` (e.g. `--no-semantic`, `--no-vec`) to drop one part.

The wizard asks for your vault path and which IDE(s) to wire; the `-y` form skips all prompts. Either
way it writes the MCP config and scaffolds a starter vault (`START_HERE.md`, `MEMORY.md`, `PROJECTS/`,
`SESSION_LOG.md`, `PRACTICES/`, `STACKS/`, `_meta/agent-profiles.md`).

## One-command, non-interactive (CI / fresh PC)

```bash
# Codex CLI + Claude Code, hybrid search + multilingual embeddings, backend installed,
# index built, rules written — everything, from a kit clone:
node packages/create-obsidian-memory/src/index.js --full --vault "$HOME/my-vault" --repo-root .

# …or spell it out (and add cursor) instead of --full:
node packages/create-obsidian-memory/src/index.js --non-interactive \
  --vault "$HOME/my-vault" --ide codex,claude,cursor \
  --with-hybrid --semantic --install-backend --build-index --rules all --repo-root .
```

`--with-hybrid` (and `--full`'s hybrid step) needs a local clone of the kit — it wires the Node
bridge + Python backend — so run it from the clone or pass `--repo-root <clone>`. The plain
`basic-memory` path needs no clone, and `--full` falls back to it (with a warning) if no clone is
found.

## Options

| Flag                               | Purpose                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--lang en`                        | English prompts (default is Spanish-first).                                                                                                                                                                                                                                                                                                              |
| `--full`, `--all`                  | **One-shot max power, every feature on (implies `-y`).** Defaults `--ide` to `codex,claude`; turns on `--with-hybrid --semantic --vec --build-index --install-backend` + rules per agent. Degrades to `basic-memory` (no abort) without a kit clone. Opt out: `--no-semantic` / `--no-vec` / `--no-build-index` / `--no-install-backend` / `--no-rules`. |
| `--dry-run`                        | Print what would be written — no writes.                                                                                                                                                                                                                                                                                                                 |
| `-y`, `--yes`, `--non-interactive` | Headless mode (no prompts).                                                                                                                                                                                                                                                                                                                              |
| `[vault]` (positional)             | Vault path as the first argument (e.g. `… ./my-vault -y`); same as `--vault`.                                                                                                                                                                                                                                                                            |
| `--vault <path>`                   | Vault root (absolute or cwd-relative). Optional — defaults to `~/Documents/obsidian-memory-vault`, created if missing.                                                                                                                                                                                                                                   |
| `--ide <list>`                     | IDEs to wire, comma-separated: `codex`, `claude`, `cursor` (default: `cursor`; with `--full`: `codex,claude`).                                                                                                                                                                                                                                           |
| `--no-cursor-mcp`                  | Skip writing `~/.cursor/mcp.json`.                                                                                                                                                                                                                                                                                                                       |
| `--no-git-init`                    | Skip `git init` when the vault has no `.git`.                                                                                                                                                                                                                                                                                                            |
| `--with-hybrid`                    | Also wire `obsidian-memory-hybrid` (needs a kit clone; use `--repo-root` or cwd walk).                                                                                                                                                                                                                                                                   |
| `--repo-root <path>`               | Root of the `obsidian-memory-kit` clone (hybrid bridge + Python source).                                                                                                                                                                                                                                                                                 |
| `--semantic`                       | With `--with-hybrid`: neural embeddings (fastembed multilingual; needs the `[semantic]` extra).                                                                                                                                                                                                                                                          |
| `--vec`                            | With `--with-hybrid`: sqlite-vec acceleration (needs the `[vec]` extra; sets `OBSIDIAN_MEMORY_SQLITE_VEC=1`). Ranking-identical with a safe fallback. On under `--full`; opt out with `--no-vec`.                                                                                                                                                        |
| `--rerank`                         | With `--with-hybrid`: cross-encoder reranker for a top-k precision boost (installs the `[rerank]` extra; sets `OBSIDIAN_MEMORY_RERANK=1`). **Opt-in only** — downloads a model on first use and needs a content-language-matched model (the multilingual default); **not** enabled by `--full`.                                                          |
| `--build-index`                    | After wiring, build the local FTS (+ semantic) index (needs the Python backend).                                                                                                                                                                                                                                                                         |
| `--install-backend`                | `pip install -e` the Python RAG backend (best-effort; on by default under `--full`).                                                                                                                                                                                                                                                                     |
| `--with-gitleaks`                  | Install a gitleaks pre-commit hook in `<vault>/.git/hooks/`.                                                                                                                                                                                                                                                                                             |
| `--rules <list>`                   | Install the memory-rules block into `claude` (`~/.claude/CLAUDE.md`), `codex` (`~/.codex/AGENTS.md`), `agents` (`./AGENTS.md`), `cursor` (`.cursor/rules`). Or `all` / `none`. Idempotent; never clobbers your content. Headless writes nothing unless passed (or `--full`); interactive asks.                                                           |
| `--no-rules`                       | Don't write any rules file.                                                                                                                                                                                                                                                                                                                              |
| `--help`                           | Show usage.                                                                                                                                                                                                                                                                                                                                              |

- `codex` registers servers via the Codex CLI (`codex mcp add` → `~/.codex/config.toml`).
- `claude` registers servers via the Claude Code CLI (`claude mcp add -s user`).
- `cursor` writes `~/.cursor/mcp.json`.

### Install the memory rules too

The initializer can also drop the **memory-protocol rules** (how the agent should use the vault), not just the MCP wiring. Use `--rules all` for full coverage:

```bash
npx @vkmikc/create-obsidian-memory@latest ./my-vault -y --ide cursor,claude --rules all
```

It writes an **idempotent marked block** (`<!-- obsidian-memory:start --> … <!-- obsidian-memory:end -->`) into `~/.claude/CLAUDE.md`, `./AGENTS.md` and `.cursor/rules/obsidian-memory.mdc`, merging in place — **your own content is never touched**, and re-runs just refresh the block. Cursor's _global_ User Rules can't be auto-written (not a file), so paste that one from the install guide.

## What the installed memory does

Beyond wiring the MCP, the kit installs a **memory protocol** (the rules block above) and scaffolds a vault designed to get smarter over time while staying token-cheap:

- **Passage-first recall** — the agent pulls the matching _section_ of a note (`vault_hybrid_search`), not the whole file, and checks the vault _before answering_ when a task continues prior work or names a known project/person/tool.
- **Graph-aware recall + autocomplete (v3.5)** — `vault_hybrid_search` can follow your `[[wikilinks]]` (opt-in `graph: true`), so a note linked from a strong hit surfaces even when its own words barely match; `vault_complete` resolves a prefix to the titles / filenames / `#tags` that exist. See [how it works](https://github.com/Vahlame/obsidian-memory-kit/blob/main/docs/en/how-it-works.md#the-retrieval-stack-at-a-glance-old--new).
- **Measured, not just claimed (v3.7)** — retrieval quality is benchmarked against a fixed labelled corpus and gated in CI (recall@k / MRR / hit@1), so a recall regression fails the build instead of shipping silently. A missing or misspelled term also no longer drops a relevant note (lexical search falls back from strict AND to OR). See [`evals/retrieval`](https://github.com/Vahlame/obsidian-memory-kit/tree/main/evals/retrieval).
- **Structured knowledge graph (v3.8)** — typed relations (`- implements [[adr-0014]]`) and categorized observations (`- [decision] … #tag`) authored in plain Markdown (Basic-Memory-compatible) become queryable: `vault_relations` answers "what supersedes this / what links here?" both directions, `vault_observations` pulls every `[decision]` or `#tag` across the vault, and `vault_kg_suggest` proposes structure for a note (read-only — you confirm and edit). See [ADR-0023](https://github.com/Vahlame/obsidian-memory-kit/blob/main/docs/adr/0023-structured-knowledge-graph.md).
- **Memory reports (v3.8)** — `vault_memory_report` is a read-only digest for periodic upkeep: automatic indices (observations by category, graph hub notes, top `#tags`), hygiene (oversized / stale / orphan notes, broken links, `SESSION_LOG` bloat) with concrete next steps, and opt-in near-duplicate pairs to review. It flags what to condense; it never rewrites a note. See [ADR-0024](https://github.com/Vahlame/obsidian-memory-kit/blob/main/docs/adr/0024-memory-reports-and-compaction.md).
- **sqlite-vec acceleration (v3.8, opt-in, on under `--full`)** — for large vaults, the cosine scan runs inside SQLite over the same index file via the sqlite-vec extension; ranking is **identical** to the pure-Python path (verified by the bench + a parity test) with a transparent fallback. The in-file embedded answer — no Chroma/LanceDB server. See [ADR-0025](https://github.com/Vahlame/obsidian-memory-kit/blob/main/docs/adr/0025-optional-sqlite-vec-acceleration.md).
- **Self-check** — before non-trivial answers it sanity-checks its own assumptions and edge cases (scaled to the task, internal — no padding).
- **Coach, don't impose** — flags high-impact anti-patterns in your code as a _question_ and logs them to `PRACTICES/observations.md`; promotes to `confirmed-{good,bad}.md` only when you confirm.
- **Evolving memory** — records new tech in `STACKS/`, firm preferences in `MEMORY.md`, hypotheses → facts.
- **Model-aware** — reads `_meta/agent-profiles.md` to tune behavior to the active model's strengths (Claude, Cursor Composer, GPT, DeepSeek, Gemini…) and learns which model fits which task over time.
- **Token economy** — all of the above is bounded by passage-first reads, terse bullets and dedup, so smarter ≠ pricier.

Read the rules block before installing — it's printed in [`docs/en/install.md`](https://github.com/Vahlame/obsidian-memory-kit/blob/main/docs/en/install.md) (Step 4) and is what `--rules` writes (idempotently) into your agent configs.

## Requirements

- **Node.js ≥ 20**
- **[`uv`](https://docs.astral.sh/uv/)** (for `uvx basic-memory mcp`)
- For `--with-hybrid` / `--build-index` / `--install-backend`: **Python ≥ 3.11** + `pip`, and a clone of the kit (`obsidian-memory-rag`).
- For `--ide claude`: the **Claude Code** CLI on `PATH`. For `--ide codex`: the **Codex** CLI on `PATH` (otherwise the installer prints the `codex mcp add` command + a `config.toml` block to paste).

## License

MIT © Vahlame. See the [repository](https://github.com/Vahlame/obsidian-memory-kit) for details.

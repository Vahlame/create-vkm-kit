# ADR-0022: Codex CLI as a first-class wiring target + `--full` one-shot preset

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** maintainer

## Context

The initializer (`@vkmikc/create-obsidian-memory`) wired two agents directly:
Cursor (writes `~/.cursor/mcp.json`) and Claude Code (shells out to `claude mcp
add -s user`). **Codex CLI** — an increasingly common terminal agent — was only a
_passive_ consumer of the repo's `AGENTS.md`, never a wiring target, so a Codex
user had to hand-edit `~/.codex/config.toml` to connect the memory MCP.

Separately, getting the _full_ power of the kit (hybrid BM25+semantic retrieval,
neural embeddings, a pre-built index, and the memory-protocol rules) required
stacking five flags **and** a manual `pip install -e …[semantic]`:

```bash
--ide cursor,claude --with-hybrid --semantic --build-index --rules all   # + pip install
```

That is too much ceremony for the request "install it the simplest way, with all
its power, Codex and Claude first."

Codex's MCP config was verified against the official docs
(`developers.openai.com/codex/mcp`): servers live in `~/.codex/config.toml` under
`[mcp_servers.<name>]`, and the CLI registers them with
`codex mcp add <name> --env KEY=VALUE … -- <command> <args>` (name positional,
repeatable `--env`, launcher after `--`), with `codex mcp remove`/`list` to manage
them.

## Decision

1. **Codex CLI becomes a first-class `--ide codex` target.** We shell out to
   `codex mcp add` (idempotent via a preceding `codex mcp remove`), reusing the
   exact same `basicMemoryServer` / `hybridServer` objects as the Cursor and
   Claude paths — one canonical server definition, three front-ends. If `codex`
   isn't on `PATH` we print both the `codex mcp add` command **and** a
   ready-to-paste `[mcp_servers.*]` TOML block (Windows backslashes escaped).
   Global Codex instructions get a new rules target writing `~/.codex/AGENTS.md`
   (project-level `./AGENTS.md` stays covered by the `agents` target).

2. **A `--full` (alias `--all`) one-shot preset.** It implies `-y` and turns on
   `--with-hybrid --semantic --build-index --install-backend` plus the rules for
   each wired agent, and defaults `--ide` to **`codex,claude`** (the requested
   focus). New `--install-backend` runs `pip install -e …[semantic]` best-effort
   so a fresh machine needs no separate step. Each heavy piece has a `--no-*`
   opt-out. Crucially, `--full` **degrades** rather than aborts: if no kit clone
   is found to source the hybrid bridge from (e.g. run via bare `npx` outside a
   clone), it warns and wires `basic-memory` only instead of `exit 2` — the hard
   failure is reserved for an _explicit_ `--with-hybrid`.

The dream command becomes `create-obsidian-memory --full` (run from a clone, or
with `--repo-root`), and the interactive wizard now pre-selects Codex + Claude
Code.

## Alternatives considered

- **Hand-merge `~/.codex/config.toml` ourselves (TOML parser + writer):**
  Rejected — duplicates a merge the vendor CLI already does safely, and a
  hand-rolled TOML writer is a new failure surface (quoting, escaping, comment
  preservation). We emit a TOML block only as a _copy-paste fallback_, never as
  the primary write path. Mirrors the Claude Code rationale (ADR-0002-style:
  let the tool own its config).
- **Change the global default `--ide` from `cursor` to `codex,claude`:**
  Rejected — silently breaks existing headless callers and muscle memory. The new
  focus is expressed through `--full` and the wizard defaults instead, leaving
  bare `-y` back-compatible.
- **Make `--full` hard-fail without a kit clone:** Rejected — defeats "simplest
  possible." Graceful degradation keeps the one-shot always-succeeding.

## Consequences

- **Positive:** Codex users get one-command wiring; the full stack is a single
  memorable flag; Codex + Claude are the documented default focus; one server
  definition still feeds every front-end (no drift).
- **Negative:** `--install-backend` runs `pip` against the user's environment
  (best-effort, opt-out via `--no-install-backend`); `--full`'s degradation means
  a missing clone yields a quieter basic-only install rather than a loud error —
  surfaced by an explicit warning line.
- **Neutral:** No version-marker change (feature lands under `[Unreleased]`);
  `codex` joins `claude`/`agents`/`cursor` in the `--rules` vocabulary and in
  `all`.

## References

- `packages/create-obsidian-memory/src/mcp-merge.mjs` — `codexAddArgv`,
  `codexRemoveArgv`, `codexTomlBlock`.
- `packages/create-obsidian-memory/src/index.js` — `registerCodexMcp`,
  `maybeInstallBackend`, `fullPresetFromArgs`, `--full` path.
- `developers.openai.com/codex/mcp` — Codex MCP config + `codex mcp add` syntax.
- [ADR-0011](0011-adopt-agents-md.md) — `AGENTS.md` as the IDE-agnostic surface.

# ADR-0087: Kimi Code as a first-class wiring target (`--ide kimi`)

- **Status:** Accepted
- **Date:** 2026-08-11
- **Deciders:** maintainer

## Context

Kimi Code CLI (`kimi`, `@moonshot-ai/kimi-code` on npm) is a Claude-Code-class
terminal agent, and until now the kit's only answer for it was the generic
`--skills-dir` escape hatch plus a paste-ready MCP block — no MCP registration,
no rules, no hooks. Every surface Kimi Code exposes was verified against the
official docs (`kimi.com/code/docs/en/`) and, where the docs were ambiguous,
against the running CLI:

- **MCP:** `~/.kimi-code/mcp.json` (moves with `KIMI_CODE_HOME`), the same
  `{"mcpServers": {...}}` shape Cursor uses. There is **no** `kimi mcp add`
  CLI command — the JSON file IS the documented config surface.
- **Rules:** global instructions live at `$KIMI_CODE_HOME/AGENTS.md`.
- **Skills/agents:** `~/.kimi-code/skills/<name>/SKILL.md` and
  `~/.kimi-code/agents/*.md`; the agent format tolerates Claude-Code-style
  frontmatter (unknown fields are ignored).
- **Hooks:** `[[hooks]]` array-of-tables in `config.toml` (TOML), exactly four
  allowed fields (`event`/`matcher`/`command`/`timeout`) — an extra field makes
  the CLI reject the whole file. Blocking = exit code 2 with the reason on
  stderr. The transcript is
  `~/.kimi-code/sessions/<wd>/session_<id>/agents/main/wire.jsonl`, with tool
  calls as `context.append_loop_event` lines.
- **The docs lie by omission about `SessionStart`:** it is an observation-only
  event and its stdout never reaches the context (verified live: the hook ran
  — it wrote its sidecar — and nothing was injected). `UserPromptSubmit` is the
  event whose stdout IS documented to be appended to the context.

## Decision

1. **`kimi` becomes a first-class `--ide` target and joins the `--full`
   default list** (`codex,claude,cursor,kimi`), following the ADR-0022
   precedent. MCP registration merges into `~/.kimi-code/mcp.json` with the
   same merge-preserve-backup code path as Cursor (`writeCursorMcp`'s body is
   now a shared `writeJsonMcp`; `writeKimiMcp` resolves the directory through
   `KIMI_CODE_HOME`).
2. **Rules target `kimi`** writes the managed block to
   `~/.kimi-code/AGENTS.md`; skills install to `~/.kimi-code/skills/` and a
   dedicated agent template (`vkm-implementer.kimi.md`, without the Claude-only
   `model` field) to `~/.kimi-code/agents/vkm-implementer.md`.
3. **Hooks ride a managed TOML block, not a parser.** The kit owns the text
   between `# vkm-kit:start` / `# vkm-kit:end` comment sentinels in
   `config.toml` (comments are valid TOML anywhere), so no TOML writer ever
   touches the user's providers, credentials or own `[[hooks]]` entries, and
   only the four documented fields are emitted. `config.toml` is backed up
   before every managed write.
4. **The hook subset is the two that map:** vault-context injection and the
   close-ritual nudge. Token-saver, native-memory guard and effort-gate stay
   Claude/Codex-only (Kimi has no auto-memory, no `/effort`, and its wire
   format is not a contracted transcript API for output rewriting).
   - Context injection runs on **`UserPromptSubmit`, once per session**
     (sidecar marker under `~/.vkm/kimi-context-injected/`), because
     `SessionStart` drops hook stdout (see Context). Without the marker the
     vault map would tax every prompt.
   - The Stop nudge scans the session's `wire.jsonl` (located from the
     payload's `session_id`), shares the Claude hook's policy regexes and
     reason text verbatim, blocks via exit code 2, and self-limits to once per
     session with its own marker (Kimi documents no `stop_hook_active`).
5. **`npm run setup` auto-detects `kimi`** on PATH, includes it in the wired
   IDEs, and verifies by reading `mcp.json` (no CLI query exists).

## Consequences

- `--full` now creates `~/.kimi-code/` on machines without Kimi Code — the
  same trade-off ADR-0022 accepted for Cursor, and the directory is inert
  without the CLI.
- A resumed Kimi session does not get the vault context re-injected (the
  once-per-session marker persists across resumes). Accepted: the injection
  survives in the resumed transcript, and re-injecting on every resume would
  re-tax long-lived sessions.
- **Print mode (`kimi -p`) fires `UserPromptSubmit` but not `Stop`** (verified
  live with a recording hook: the payload never arrived). The close-ritual
  nudge is therefore an interactive-TUI feature; the script itself is verified
  end-to-end by direct invocation against a real session's `wire.jsonl`
  (finds the wire, counts edits, blocks with exit 2, writes its marker).
  Conversely `SessionStart` DOES fire in print mode — it just drops stdout,
  which is why the context injection could not ride it.
- The Postgres keep-alive hook is not ported to Kimi yet; the projection
  works without it (it is started on demand by `vault_pg_status`).
- Uninstall (`--uninstall`) strips the managed TOML block and the hash-tracked
  assets; it never removes a user's own `[[hooks]]` entry or a locally edited
  file.

## Alternatives considered

- **TOML parse-and-rewrite of `config.toml`:** rejected — one serializer
  formatting decision (or a parse bug) rewrites the file that holds the user's
  API keys. The sentinel block edits only text the kit owns.
- **`SessionStart` for context injection (the Claude shape):** rejected on
  evidence — verified live that its stdout is dropped.
- **Skills into the shared `~/.agents/skills/` only:** Kimi does scan it, but
  that directory is Codex's install target in this kit; installing there for a
  kimi-only user would make Codex (if ever installed) inherit skills the user
  never asked it to have. `~/.kimi-code/skills/` is the Kimi-specific,
  `KIMI_CODE_HOME`-relocatable home.

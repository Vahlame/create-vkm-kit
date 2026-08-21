# Cursor parity handoff

Verified 2026-08-03 against Cursor Agent Skills + Hooks (create-skill / create-hook).
Keeps Claude Code ↔ Cursor surfaces aligned.

## Skills

- Install path: `$HOME/.cursor/skills/{vkm-discipline,vkm-spec,…}/` (all eight shipped skills).
- Source: `packages/create-vkm-kit/templates/skills/`.
- Canonical Cursor-only path is `~/.cursor/skills`. (Whether Cursor also loads
  `~/.claude/skills/` is **unverified** — do not rely on cross-loading; install with
  `--ide cursor` so the Cursor home is populated.)
- No `vkm-implementer` agent template for Cursor (Task subagent types differ).
- Multi-window note: `cursor-session-state.json` is one global file under `~/.vkm/` — two
  simultaneous Cursor windows share the stop-nudge counters.

## Rules

- Global: `$HOME/.cursor/rules/obsidian-memory.mdc` (`alwaysApply: true`) is a **short
  pointer** when the project also has `AGENTS.md` (ADR-0089). Cursor-only installs still
  write the full protocol to the project `.mdc`.
- **Do not paste the full block into Settings → User Rules** — that duplicates tokens and
  User Rules outrank the files.

## Hooks

- Config: `$HOME/.cursor/hooks.json` (`version: 1`).
- Scripts: `$HOME/.cursor/hooks/`.
- Mapping: `sessionStart` vault context · `afterFileEdit`/`afterMCPExecution` trackers ·
  `stop` close nudge · MCP JSON token-saver.
- **Not ported (honest):**
  - Claude native-memory write guard and effort advisor.
  - Bash / shell output compaction (Cursor has no `afterBash` event; only MCP JSON is compacted).

## Checks

```bash
npm test --workspace @vkmikc/create-vkm-kit
```

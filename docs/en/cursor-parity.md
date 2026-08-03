# Cursor parity handoff

Verified 2026-08-03 against Cursor Agent Skills + Hooks (create-skill / create-hook).
Keeps Claude Code ↔ Cursor surfaces aligned.

## Skills

- Install path: `$HOME/.cursor/skills/{vkm-discipline,vkm-spec,…}/`.
- Source: `packages/create-vkm-kit/templates/skills/`.
- Cursor may also load `$HOME/.claude/skills/` when both are present; the Cursor-only
  canonical path is `~/.cursor/skills`.
- No `vkm-implementer` agent template for Cursor (Task subagent types differ).

## Rules

- Global: `$HOME/.cursor/rules/obsidian-memory.mdc` (`alwaysApply: true`).
- Project (optional): `<cwd>/.cursor/rules/obsidian-memory.mdc` when cwd ≠ home.
- Cursor **Settings → Rules → User Rules** remains a manual paste surface.

## Hooks

- Config: `$HOME/.cursor/hooks.json` (`version: 1`).
- Scripts: `$HOME/.cursor/hooks/`.
- Mapping: `sessionStart` vault context · `afterFileEdit`/`afterMCPExecution` trackers ·
  `stop` close nudge · MCP JSON token-saver.
- **Not ported (honest):** Claude native-memory write guard and effort advisor.

## Checks

```bash
npm test --workspace @vkmikc/create-vkm-kit
```

# Kimi Code CLI parity hand-off

Verified on 2026-08-11 against the official Kimi Code docs (`kimi.com/code/docs/en/`) **and** the
live CLI (`kimi` 0.34.0) where the docs were ambiguous. This is the continuation note for a Claude
Code session keeping the Kimi and Claude surfaces aligned. Decision record: ADR-0087
(`--ide kimi` follows the ADR-0022 Codex precedent).

## Skills

- Installed path: `~/.kimi-code/skills/{vkm-discipline,vkm-spec,vkm-design,vkm-research,vkm-verify,vkm-intake,vkm-ui-judge,vkm-seo}/`
  (all eight shipped skills — same set as Claude/Codex/Cursor). The whole tree moves with
  `KIMI_CODE_HOME`.
- Source: `packages/create-vkm-kit/templates/skills/`; the installer copies every file in
  each directory, so each `SKILL.md` remains byte-identical.
- Official source: [Skills](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html),
  fetched 2026-08-11.
- Keep in sync: if a skill directory is added or renamed, update `SKILL_NAMES`, the
  `skills-install` tests, and every IDE install scope. `skill-count-drift.test.mjs` gates the
  parity docs.

## Custom agent

- Installed path: `~/.kimi-code/agents/vkm-implementer.md`.
- Source contract: `packages/create-vkm-kit/templates/agents/vkm-implementer.kimi.md` — a
  dedicated template that preserves the terse, minimal-diff implementer rules while omitting the
  Claude-only `model` field (Kimi tolerates Claude-Code-style frontmatter; unknown fields are
  ignored).
- Official source: [Agents](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents.html),
  fetched 2026-08-11.

## Hooks

- Config path: `~/.kimi-code/config.toml` — a **managed block** between the
  `# vkm-kit:start` / `# vkm-kit:end` TOML comment sentinels, so no TOML writer ever touches the
  user's providers, credentials or own `[[hooks]]` entries. Only the four documented fields
  (`event`/`matcher`/`command`/`timeout`) are emitted; `config.toml` is backed up before every
  managed write.
- Script path: `~/.kimi-code/hooks/`.
- Managed event mapping:
  - `UserPromptSubmit` → `kimi-session-start-vault-context.mjs` injects the vault map and memory
    reminders on the **first prompt of each session only** (sidecar marker under
    `~/.vkm/kimi-context-injected/`). It does **not** ride `SessionStart`: that event is
    observation-only and its stdout never reaches the context (verified live — the hook ran, wrote
    its sidecar, and nothing was injected).
  - `Stop` → `kimi-stop-vault-close-reminder.mjs` nudges the close ritual **once per session**
    when substantive file work never touched the vault. It scans the session's
    `~/.kimi-code/sessions/<wd>/session_<id>/agents/main/wire.jsonl`, shares the Claude hook's
    policy regexes and reason text verbatim, and blocks via exit code 2.
- **Print-mode caveat:** `kimi -p` fires `UserPromptSubmit` but **not** `Stop` (verified live with
  a recording hook: the payload never arrived). The close-ritual nudge is therefore an
  interactive-TUI feature; the script itself is verified end-to-end by direct invocation against a
  real session's `wire.jsonl`.
- Official source: [Hooks](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html),
  fetched 2026-08-11. Blocking = exit code 2 with the reason on stderr.
- Not ported (remain Claude/Codex-only): token-saver, telemetry, native-memory guard, effort-gate —
  Kimi has no native auto-memory and no `/effort` harness. The Postgres keep-alive hook is not
  ported either; the projection works without it.

## MCP

- Config path: `~/.kimi-code/mcp.json` (moves with `KIMI_CODE_HOME`), the same
  `{"mcpServers": {...}}` shape Cursor uses; merged with the same merge-preserve-backup code path.
- There is **no** `kimi mcp add` CLI command — the JSON file IS the documented config surface, and
  `npm run setup` verifies the wiring by reading it. MCP config loads at session start: open a new
  session and check with `/mcp`.
- Official source: [MCP](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html),
  fetched 2026-08-11.

## Rules

- Installed path: `~/.kimi-code/AGENTS.md` — the idempotent managed memory-rules block, written by
  `--rules kimi` (also included in `--rules all`).

## Verified drift and follow-up

- **Verified drift:** the docs lie by omission about `SessionStart` — its stdout is dropped, so
  context injection rides `UserPromptSubmit` gated by a once-per-session marker. Consequence: a
  resumed session does not get the vault context re-injected (the marker persists across resumes).
  Accepted — the injection survives in the resumed transcript.
- **Not yet verified / follow-up:** Kimi documents no `stop_hook_active`, so the Stop nudge
  self-limits with its own once-per-session marker. Revisit if Kimi publishes a re-entry guard.

## Checks before changing this port

```bash
npm test --workspace @vkmikc/create-vkm-kit
node packages/create-vkm-kit/src/index.js --ide kimi --vault <tmp> --non-interactive
npm run sync-agents:check
npm run lint
npm run typecheck
npm test
```

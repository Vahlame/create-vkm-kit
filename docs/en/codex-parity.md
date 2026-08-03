# Codex CLI parity hand-off

Verified on 2026-07-27 against the current official Codex manual (Stop hook added
2026-08-03). This is the continuation note for a Claude Code session keeping the Codex
and Claude surfaces aligned.

## Skills

- Installed path: `$HOME/.agents/skills/{vkm-discipline,vkm-spec,vkm-design,vkm-research,vkm-verify,vkm-intake,vkm-ui-judge,vkm-seo}/`
  (all eight shipped skills — same set as Claude/Cursor).
- Source: `packages/create-vkm-kit/templates/skills/`; the installer copies every file in
  each directory, so each `SKILL.md` remains byte-identical.
- Official source: [Build skills](https://learn.chatgpt.com/docs/build-skills), fetched
  2026-07-27. It requires a directory containing `SKILL.md` with `name` and `description`,
  and documents `$HOME/.agents/skills` as the user scope.
- Keep in sync: if a skill directory is added or renamed, update `SKILL_NAMES`, the
  `skills-install` tests, and both Claude and Codex update scopes. `skill-count-drift.test.mjs`
  also gates this parity doc.

## Custom agent

- Installed path: `$HOME/.codex/agents/vkm-implementer.toml`.
- Source contract: `packages/create-vkm-kit/templates/agents/vkm-implementer.md`; the
  Codex TOML counterpart preserves the terse, minimal-diff implementer rules while omitting
  Claude-only model metadata.
- Required keys: `name`, `description`, and `developer_instructions`.
- Official source: [Codex full manual — Subagents](https://developers.openai.com/codex/llms-full.txt),
  fetched 2026-07-27. It documents one standalone TOML file per agent under
  `~/.codex/agents/` (or `.codex/agents/` for project scope).
- Keep in sync: edit both templates deliberately; `codex-native.test.mjs` parses the TOML
  with `@iarna/toml` and asserts all required values are non-empty.

## Hooks

- Config path: `$HOME/.codex/hooks.json`.
- Script path: `$HOME/.codex/hooks/`; every shipped script is SHA-256 tracked in
  `$HOME/.codex/vkm-kit.assets.json`.
- Managed event mapping:
  - `SessionStart` → `session-start-vault-context.mjs` injects the vault map and reminders
    via nested `hookSpecificOutput.additionalContext` (same shape Claude Code consumes;
    Codex honors `additionalContextLimit` on the handler).
  - `PreToolUse` → `codex-guard-native-memory-write.mjs` protects generated
    `~/.codex/memories/` paths; `guard-effort-gate.mjs` runs the effort advisor on
    `apply_patch`.
  - `PostToolUse` → `codex-compact-tool-output.mjs` compacts noisy shell/MCP output.
  - `Stop` → `stop-vault-close-reminder.mjs` (same ADR-0030 nudge as Claude Code).
- Official sources: [Hooks](https://learn.chatgpt.com/docs/hooks), fetched 2026-07-27;
  [Memories](https://learn.chatgpt.com/docs/customization/memories), fetched 2026-07-27.
  Hooks documents `hooks.json`, JSON stdin/stdout, `PreToolUse` denial via exit code `2`
  or a deny decision, and `SessionStart`/`PostToolUse` context behavior. Memories documents
  generated local state under `~/.codex/memories/`.
- Merge rule: `codex-native.mjs` replaces only handlers whose command contains a stable
  vkm-kit stem. It preserves every other hook group and handler; uninstall removes only
  hash-matching scripts and those marked entries.

## Verified drift and follow-up

- **Verified drift:** Codex's current Hooks documentation says `updatedMCPToolOutput` is
  parsed but unsupported. The Codex token-saver therefore returns compacted content through
  `PostToolUse` feedback with `continue: false`; it cannot mutate `tool_response` in place as
  Claude Code does. Do not silently switch this behavior—revisit it when Codex supports a
  typed replacement field.
- **Not yet verified / follow-up:** `transcript_path` is documented as unstable. The effort
  gate and Stop close-reminder reuse the cross-platform transcript scanner and are fail-open
  if a future Codex rollout format no longer exposes the required turns. Prefer stable event
  fields if Codex publishes them, then add a real-rollout fixture before changing the gate.
- **Not yet verified / follow-up:** user hooks require Codex trust review (`/hooks`) before
  non-managed commands run. The installer intentionally does not bypass that trust step;
  verify the first-run UX on current CLI releases before promising zero-touch activation.
- Do not revive `~/.codex/prompts/*.md` integration. [Custom prompts](https://learn.chatgpt.com/docs/custom-prompts)
  is deprecated in favor of Skills; use the Skills surface above.

## Checks before changing this port

```bash
npm test --workspace @vkmikc/create-vkm-kit
node packages/create-vkm-kit/src/index.js --ide codex --vault <tmp> --non-interactive
npm run sync-agents:check
npm run lint
npm run typecheck
npm test
```

The installer test uses a fake `codex` executable so it can exercise real file writes without
changing the maintainer's actual Codex profile. Keep that hermetic boundary when adding cases.

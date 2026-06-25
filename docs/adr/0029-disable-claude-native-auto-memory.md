# ADR-0029: Disable Claude Code's native auto-memory in favor of the vault

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** maintainer

## Context

Claude Code ships its own **native auto-memory**: a per-project directory
`~/.claude/projects/<encoded-path>/memory/` with a `MEMORY.md` that the harness
**auto-loads every session**, and the base system prompt instructs the model to **write**
to it with the `Write` tool. This competes head-on with this kit's Obsidian vault, and in
real use the native side **wins by default**, for two structural reasons:

1. It lives in the **base system prompt** with the `Write` tool **always** available
   (zero friction).
2. The vault's tools (`mcp__obsidian-memory-hybrid__vault_*`) are frequently **deferred**
   (not loaded at session start when many MCP servers are connected), so the agent takes
   the path of least resistance and writes the close ritual into the native memory.

The result is **fragmented memory** across two systems — the exact failure the kit exists
to prevent. The fix was validated by hand on one machine; this ADR ports it into the
installer so every fresh install is correct by default. Constraints: Windows-first
(backslash paths, PowerShell), idempotent (merge, never clobber), no admin.

## Decision

When `create-obsidian-memory` wires Claude Code (`--ide claude`, on by default in the
full stack), it also configures the native-memory **override**:

1. **Turn the native auto-memory off** — write `"autoMemoryEnabled": false` into
   `~/.claude/settings.json` via an idempotent deep merge that preserves every other key
   and hook, validates the result parses, and backs up (then skips) invalid prior JSON.
2. **Install a `SessionStart` hook** — copy a **cross-platform Node** script
   (`~/.claude/hooks/session-start-vault-context.mjs`) and register it as
   `node "<hook>" "<vault>" <lang>`. The hook injects the vault map (`_meta/index.md` +
   top-level folders) plus reinforced **precedence reminders**: the vault is the only
   source of truth, the native memory is a read-only mirror, the **first step** of a
   non-trivial session is to `ToolSearch`-load deferred `vault_*` tools before touching
   memory, recall is `vault_hybrid_search`, and the close ritual writes to
   `SESSION_LOG.md` + `PROJECTS/<project>.md` with each edit anchored on one CRLF line.
3. **Reinforce the rules block** — the managed `CLAUDE.md`/`AGENTS.md`/`.cursor` block
   gains a top `## Precedencia de memoria (OVERRIDE)` section with the same doctrine.

The hook registration is idempotent: re-runs (and a legacy PowerShell `.ps1` variant) are
recognized by the shared filename stem `session-start-vault-context` and **replaced**,
never duplicated. Opt out with `--minimal` or `--no-native-memory-override`.

## Alternatives considered

- **Per-OS hook scripts (`.ps1` on Windows, `.sh` on POSIX):** rejected — it forks the
  reminder text into two files that must stay in sync, and Node is already a hard
  dependency of the installer. A single `.mjs` invoked via `node` is portable and keeps
  one source of truth for the reminder copy.
- **Only the env var `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`:** rejected as the sole
  mechanism — an env var isn't durably set across shells/sessions the way a settings key
  is. The documented `autoMemoryEnabled` key in `settings.json` is the reliable switch
  (the env var remains a valid manual escape hatch).
- **Rules block only (no settings change):** rejected — relying on the model to _honor_ a
  rule against a `Write` tool that's always present in the base prompt is exactly what
  failed in practice. Disabling the competing system at the config level is what makes the
  precedence real instead of aspirational.

## Consequences

- **Positive:** a fresh install leaves the Obsidian vault as Claude Code's single source
  of truth, with no manual steps; the SessionStart hook also surfaces the vault index for
  free each session. Idempotent and reversible (`--no-native-memory-override`, or flip the
  settings key back).
- **Negative:** the installer now writes to `~/.claude/settings.json` and
  `~/.claude/hooks/` (previously untouched) — mitigated by merge-don't-clobber, a backup,
  and a dry-run preview. The hook command assumes `node` is on `PATH` at session start
  (true for anyone who just ran the npm installer).
- **Neutral:** Claude-Code-specific; Codex/Cursor installs are unaffected. The override is
  part of the default stack but `--minimal` opts out, consistent with the rest of the kit.

## References

- `packages/create-obsidian-memory/src/claude-native-memory.mjs`
  (`mergeClaudeSettings`, `configureClaudeNativeMemory`)
- `packages/create-obsidian-memory/src/hooks/session-start-vault-context.mjs`
- `packages/create-obsidian-memory/src/memory-rules.mjs` (precedence section)
- `packages/create-obsidian-memory/test/claude-native-memory.test.mjs`
- Claude Code `settings.json` `autoMemoryEnabled` key; `SessionStart` hook contract

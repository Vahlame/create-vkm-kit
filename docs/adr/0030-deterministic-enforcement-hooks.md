# ADR-0030: Deterministic enforcement hooks (PreToolUse guard + Stop nudge)

- **Status:** Accepted
- **Date:** 2026-06-30
- **Deciders:** maintainer

## Context

ADR-0029 made the Obsidian vault Claude Code's only memory by disabling the native
per-project auto-memory (`autoMemoryEnabled:false`) and injecting reinforced "vault is
the source of truth" reminders via a `SessionStart` hook plus the `CLAUDE.md`/`AGENTS.md`
rules block. That closed the gap **for the system that competed with the vault**.

A second gap remains, and it's the same root cause in two different shapes:

1. **Nothing technically stops a model from writing into the native-memory directory
   anyway.** `autoMemoryEnabled:false` stops the harness from auto-loading and
   prompting for it, but the `Write` tool can still target that path — a model that
   never read the rules (a very old/small model, a degraded context, a tool-call
   pattern learned from habit) can still do it. The precedence is enforced by config in
   one direction (the harness won't load it) but not the other (nothing denies writing
   to it).
2. **The "close ritual" (write learnings to `SESSION_LOG.md` + `PROJECTS/<project>.md`)
   is itself just a prose rule.** A model that skips it doesn't fail loudly — it just
   ends the session having learned nothing reusable, and the gap compounds silently
   across every future session with that project. Strong, attentive models follow the
   rule most of the time; weak, older, or hurried ones forget it, and there is no
   feedback signal telling anyone that happened.

Both gaps share the failure mode ADR-0029 already named in its own alternatives section:
**relying on a model to honor a prose rule against a default-available tool is exactly
what failed in practice.** The fix there was to disable the competing system at the
config level. The fix here is the same idea applied to enforcement instead of
configuration: use Claude Code's hook system, which runs deterministically regardless of
which model is driving, instead of hoping the model reads and complies.

Constraints: must not introduce false positives that train the user to ignore the
reminder (a hook that nags on trivial one-line fixes erodes trust); must not force the
model to write low-value memory just to silence a check (that would contradict the
existing "only what's reusable beyond the session" doctrine); must degrade safely (a bug
in either hook must never block a legitimate tool call or hang a session); must work
identically on Windows/macOS/Linux, matching the existing Node-hook precedent.

## Decision

Two new hooks, installed by `create-obsidian-memory` alongside the ADR-0029
`SessionStart` hook whenever the Claude Code native-memory override is on (new
`enforce` option, default `true`; opt out with `--no-memory-enforcement`):

1. **`PreToolUse` guard** (`guard-native-memory-write.mjs`) — denies `Write` / `Edit` /
   `MultiEdit` / `NotebookEdit` calls whose target path resolves under
   `<claudeDir>/projects/<anything>/memory/`, via
   `hookSpecificOutput.permissionDecision: "deny"` with a reason that redirects the
   model to `vault_write_file`/`vault_edit_file`. Registered with matcher
   `"Write|Edit|MultiEdit|NotebookEdit"` so the harness only invokes it for
   file-mutating tools; the script re-checks `tool_name` itself too, defensively.
2. **`Stop` nudge** (`stop-vault-close-reminder.mjs`) — scans the session's JSONL
   transcript (`transcript_path` from the hook's stdin payload) for `tool_use` blocks.
   If the session called a substantive file-editing tool (`Write`/`Edit`/`MultiEdit`/
   `NotebookEdit`) **at least twice** and never called a vault close-ritual tool
   (`vault_write_file`/`vault_edit_file`/`memory_extract_candidates`, or
   basic-memory's `write_note`/`edit_note`), it returns `{"decision":"block","reason":
"<reminder>"}` to keep the conversation going for one more turn. The reminder
   explicitly tells the model it's fine to ignore the nudge and stop normally if
   nothing from the session is worth saving — the point is to surface the choice, not
   force a write. Guarded by the input's `stop_hook_active` flag so it fires **at most
   once** per turn-chain; never loops.

Both scripts are cross-platform Node (matching the ADR-0029 precedent — one script, one
copy of the reminder text, no PowerShell/bash fork), copied into `~/.claude/hooks/` and
merged into `~/.claude/settings.json` via the same idempotent, dedup-by-filename-stem
merge `claude-native-memory.mjs` already uses for `SessionStart` (extracted into a
shared `mergeManagedHook` helper, plus a new `mergeEnforcementHooks` pure function).
Both wrap their entire `main()` in a top-level `try/catch` that swallows any error
silently — an unreadable transcript or malformed JSON payload must fall through to the
tool call proceeding / the session stopping, never block or hang it.

## Alternatives considered

- **Only the existing `CLAUDE.md` precedence rule, no hooks:** rejected — this is the
  status quo ADR-0029 already diagnosed as insufficient on its own; the whole point of
  this ADR is to add a layer that doesn't depend on the model reading and complying.
- **A hard `Stop` block (no escape hatch) whenever zero vault writes happened:**
  rejected — many sessions legitimately have nothing reusable to save (a one-line typo
  fix, a read-only question). A hook that nags every time trains the user to dismiss it
  and pressures the model into writing low-value notes, which actively works against the
  vault's own "only what's reusable beyond the session" rule. The threshold (≥2
  substantive edits) plus an explicit "ok to skip" escape hatch keeps it a nudge, not a
  gate.
- **Counting tool calls via a stateful sidecar file instead of re-parsing the
  transcript:** rejected for v1 — Claude Code already writes the full transcript to
  `transcript_path` and passes it on the `Stop` hook's stdin, so reading it is zero
  extra state to manage, survives crashes/restarts, and needs no cleanup. A sidecar
  would add a class of bugs (stale state, concurrent sessions) for no real benefit.
- **One combined on/off flag instead of `--no-memory-enforcement` nested under
  `--native-memory-override`:** rejected — the two layers protect against different
  failure modes (wrong system winning vs. no system winning) and a user might
  reasonably want the native-memory disable without the extra hooks (e.g. while
  debugging). Granular opt-out matches the kit's existing `--no-<piece>` convention.

## Consequences

- **Positive:** the vault's "win by default" property from ADR-0029 now holds
  regardless of which model drives the session — a weak/old model that ignores the
  prose rules is still blocked from writing into the wrong place and still gets nudged
  once before losing the chance to record a session's learnings. Idempotent and
  reversible (`--no-memory-enforcement`, or flip the hook entries back by hand).
- **Negative:** two more managed entries in `~/.claude/settings.json`
  (`hooks.PreToolUse`, `hooks.Stop`); a `Stop` hook adds one extra model turn on
  sessions that trip the threshold (mitigated by the loop guard — it never recurs
  within the same turn-chain, and the model can always choose to stop on the next try).
- **Neutral:** Claude-Code-specific, same as ADR-0029; Codex/Cursor installs
  unaffected. `enforce` rides along with `--native-memory-override`'s existing
  `--minimal` gating, so a `--minimal` install stays hook-free unless both flags are
  passed explicitly.

## References

- `packages/create-obsidian-memory/src/hooks/guard-native-memory-write.mjs`
- `packages/create-obsidian-memory/src/hooks/stop-vault-close-reminder.mjs`
- `packages/create-obsidian-memory/src/claude-native-memory.mjs`
  (`mergeManagedHook`, `mergeEnforcementHooks`, `configureClaudeNativeMemory`'s `enforce`
  option)
- `packages/create-obsidian-memory/test/claude-native-memory.test.mjs`
- ADR-0029 (the override this extends); Claude Code `PreToolUse`/`Stop` hook contracts
  (`hookSpecificOutput.permissionDecision`, top-level `decision`, `stop_hook_active`)

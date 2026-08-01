# ADR-0081: The effort advisor never interrupts

- **Status:** Accepted (supersedes the interruption half of [ADR-0080](./0080-the-effort-gate-decides.md))
- **Date:** 2026-08-01
- **Deciders:** maintainer

## Context

ADR-0080 already removed the wedge-prone propose-and-confirm protocol: the gate scores the
session's work deterministically, persists the resulting `effortLevel` (and model) into
`~/.claude/settings.json`, and interrupts **at most once** per session with a
`permissionDecision: "deny"` naming the level and the command that applies it.

Field verdict from the user this kit serves: even one interruption is too many for
autonomous iteration loops. A denied edit mid-loop derails the iteration — the model burns
a turn reacting to the denial text, the loop's momentum is gone, and the denial turn is
reprocessed as input on every later turn of the session. For a mechanism whose purpose is
**cost calibration**, charging a full extra model turn to deliver its advice is
self-defeating: the advice costs more than most of the savings it proposes.

What the platform offers instead was already measured for ADR-0080:

- `systemMessage` on a hook's output renders to the **user** and is never sent to the
  model — zero tokens, zero interruption.
- `effortLevel` written to `settings.json` does not change the running session but is the
  documented persistence channel: the **next** session starts there.
- The opt-in typing applier (`VKM_EFFORT_APPLY=keys`) can apply `/model` + `/effort`
  mid-session without any model involvement.

Every channel the gate needs to be useful exists without a deny.

## Decision

The gate becomes an **advisor**. `guard-effort-gate.mjs` keeps its filename, wiring,
scoring, persistence and sidecar (so upgrades are a plain file overwrite on both the
Claude Code and Codex installs), and loses the interruption entirely:

1. **No code path emits `hookSpecificOutput`.** The hook has no permission opinion; it can
   never deny, defer or delay a tool call. This is pinned by test, not convention.
2. **The decision still persists** to `~/.claude/settings.json` on every mismatch — in
   both directions. A session doing prose and small edits concludes `low`, and the next
   session simply starts cheap. This is the savings channel, and it needs nobody present.
3. **The user hears about it once per session** via `systemMessage` — the level, the
   reason, and the one command that applies it now. Rendered to the user, never sent to
   the model: the notice costs zero tokens.
4. Everything else is unchanged: sub-agent exemption, first-edit-free, `VKM_EFFORT_GATE=0`
   kill switch, `fable` never recommended or overridden, `haiku` downgrades opt-in via
   `VKM_EFFORT_ALLOW_HAIKU=1`, and the opt-in typing applier with its deferred-retry queue.
   A pre-rewrite sidecar carrying `paused` is honored as "already noticed" so an upgraded
   install never double-notifies a live session.

## Alternatives considered

- **Keep the one-time deny but make it opt-out.** Rejected: the default is where autonomous
  loops run, and a mechanism that must be turned off to be safe for its main audience is
  the wrong default. The advice loses nothing by moving to `systemMessage`.
- **Remove the hook entirely.** Rejected: the persistence channel is the one that actually
  saves money (next session starts at the right level, automatically), and it costs
  nothing to keep — no interruption, no tokens, ~ms of hook time on edits.
- **Deliver the advice to the model via `additionalContext`.** Not available: `PreToolUse`
  has no model-visible advisory field, only the permission decision — and using the
  permission channel for advice is exactly the design being removed.

## Consequences

- Positive: autonomous sessions cannot be interrupted by this hook, structurally — there
  is no deny to hit. The advice costs zero model tokens. The savings channel (persisted
  `effortLevel`, both directions) survives unchanged and now fires on sessions that would
  previously have burned a turn on the denial.
- Negative: advice the user never reads is advice not taken — a session that should run
  higher stays where it is until the next session starts. Accepted: the wrong-level cost
  is bounded and visible, the interruption cost was neither.
- Neutral: scoring, thresholds and the applier are untouched; `--effort-gate` /
  `--no-effort-gate` and `VKM_EFFORT_GATE=0` keep their meanings.

## References

- [ADR-0080](./0080-the-effort-gate-decides.md) — the decide-and-persist design this keeps
- [ADR-0031](./0031-effort-gate-hook.md) — the original pause mechanism
- `packages/create-vkm-kit/src/hooks/guard-effort-gate.mjs`, `test/effort-gate.test.mjs`

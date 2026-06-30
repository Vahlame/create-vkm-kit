# ADR-0031: Effort-gate hook (PreToolUse pause-and-confirm before costly work)

- **Status:** Accepted
- **Date:** 2026-06-30
- **Deciders:** maintainer

## Context

A model that announces "I'll pause here for your confirmation" and then immediately keeps
calling tools in the same turn is a common failure mode — the announcement is prose, and
prose doesn't stop a tool call. ADR-0029 and ADR-0030 already named this exact root cause
for two other failure modes (native-memory writes, skipped close rituals) and fixed both
with a deterministic Claude Code hook instead of relying on the model to honor a rule.
This ADR applies the same fix to a third failure mode: a human-in-the-loop checkpoint
before a session does substantial work, so the user gets a real chance to redirect before
the model commits to a direction — not just a sentence the model may or may not actually
wait on.

**This is NOT a token-efficiency feature**, and the ADR should not be read as one — an
earlier draft of this idea was justified as "minimizes tokens, maximizes cache," which
does not hold up: every time the gate fires it adds at least one full extra
turn (the model proposes a level and stops, the user replies, the model retries), and that
extra turn is reprocessed as input on every subsequent turn of the session, same as the
ADR-0030 `Stop` hook already admits for itself ("adds one extra model turn on sessions
that trip the threshold"). Prompt caching isn't broken by the extra turn, but it isn't
"maximized" by it either — the hook doesn't touch how prefixes are structured or reused.
The actual value, if any, is **avoiding wasted work**: if the pause leads the user to
redirect a misscoped task, the session saves whatever the model would have spent going the
wrong way. If the user always replies "go" on autopilot, the hook is pure overhead — no
deterministic hook can guarantee the pause is used well, the same way the ADR-0030 guard
can't guarantee what gets written to the vault is good memory, only that it lands in the
right place.

Constraints: same as ADR-0030 — must not nag on trivial one-off edits (a hook that fires on
every session erodes trust); must degrade safely (a bug must never block a legitimate tool
call or hang a session); must work identically on Windows/macOS/Linux.

## Decision

A third managed hook, installed by `create-obsidian-memory` alongside the ADR-0029
`SessionStart` hook and the ADR-0030 enforcement pair whenever the Claude Code
native-memory override is on (new `effortGate` option, default `true`, independent of
`enforce` — opt out with `--no-effort-gate`):

**`PreToolUse` gate** (`guard-effort-gate.mjs`) — denies a session's **2nd+** substantive
`Write`/`Edit`/`MultiEdit`/`NotebookEdit` call (matcher `Write|Edit|MultiEdit|NotebookEdit`,
same set the ADR-0030 `Stop` hook already uses) unless the model already proposed an effort
level **and** got a genuine reply from the user since. Mechanics:

- The **first** substantive edit of a session is always free — same anti-nagging threshold
  shape as the `Stop` hook's `MIN_SUBSTANTIVE_CALLS=2`, just applied at the start of a
  session instead of the end.
- The hook reads `transcript_path` from its stdin payload (like the `Stop` hook, not from
  argv — there's no file path to check here) and scans the JSONL transcript in order for:
  an assistant **text** block matching the literal marker `[!] RECOMENDACIÓN DE ESFUERZO` /
  `[!] EFFORT RECOMMENDATION`, and a **real** user turn after it. "Real" excludes a
  `type:"user"` entry whose content is only a `tool_result` block — Claude Code encodes
  tool results as user-role messages too, so without this check the model could call any
  tool and have its own result count as "the user replied."
- The satisfaction flag is **monotonic**: once a real reply follows a proposal, the gate
  stays open for the rest of the session, even if a later unconfirmed proposal appears.
  This is the loop-safety mechanism — `PreToolUse` hooks have no `stop_hook_active`-style
  flag to lean on the way the `Stop` hook does, so monotonicity does that job instead: the
  hook can never get stuck demanding confirmation forever, because once satisfied it's a
  permanent allow.
- The denial reason is **self-teaching**: it spells out the exact block the model should
  print, so the marker text doesn't depend on a separate `CLAUDE.md`/`AGENTS.md` rule
  change (and `memory-rules.mjs`'s managed block only ever ships into end-user projects,
  never into this repo's own `AGENTS.md` — there's no doctrine surface here to wire it
  into even if it were load-bearing).

Registers under the same `PreToolUse` matcher as the ADR-0030 native-memory guard; the two
coexist as separate `hooks.PreToolUse` array entries (Claude Code's hook dedup is by
filename stem inside the command string, not by matcher), and either may independently
deny a call.

## Alternatives considered

- **Fold into ADR-0030's `enforce` flag/`mergeEnforcementHooks` instead of a new
  independent flag:** rejected for the same reason ADR-0030 itself gave for not folding
  into ADR-0029's override — "a user might reasonably want [one] without the [other]." The
  effort gate is also a materially more invasive default than the guard/stop pair (see
  Consequences), which is its own reason to keep it separately toggleable.
- **Gate every substantive edit, not just the 2nd+:** rejected — would mean even a one-line
  typo fix requires the full propose-and-wait ritual, exactly the "nags on trivial cases"
  failure mode ADR-0030 already rejected for the `Stop` hook. The free first edit keeps
  small sessions frictionless.
- **Re-gate per task instead of once per session:** rejected for v1 — detecting "a new task
  started" deterministically from a transcript is unreliable, and a hook that re-interrogates
  the user every few messages in a long session would erode trust faster than it helps.
  Once-per-session is the same trade-off shape as the `Stop` hook's "nudge, not a
  per-edit gate" — documented here as an accepted limitation, not an oversight.
- **A stateful sidecar file to track whether the gate was satisfied, instead of re-scanning
  the transcript:** rejected for the same reason ADR-0030 rejected it — Claude Code already
  hands the hook `transcript_path`, so reading it is zero extra state to manage and survives
  crashes/restarts; a sidecar adds a stale-state/concurrent-session bug class for no benefit.
- **Justify the feature as a token/cost optimization:** rejected after fact-checking the
  actual mechanism (see Context) — the honest justification is a human checkpoint before
  costly work, with its overhead stated plainly, not an unverified efficiency claim.

## Consequences

- **Positive:** a session can no longer slide past its first substantive edit into a large,
  possibly-misdirected change without the user getting one explicit, real opportunity to
  redirect — and this holds for any model, not just ones that reliably honor a "pause and
  wait" prose instruction. Idempotent and reversible (`--no-effort-gate`, independent of the
  ADR-0030 pair).
- **Negative:** **more invasive by default than ADR-0030's two hooks.** The native-memory
  guard only blocks one narrow, almost-never-legitimate case (writing into a specific wrong
  directory), and the `Stop` nudge fires once, at the end, with an explicit skip-if-nothing
  -reusable escape hatch. This hook blocks real, intended work — every substantive edit past
  the first, every session — until a confirmation round-trip happens. That round-trip costs
  at least one extra turn (more tokens reprocessed each subsequent turn, more latency), and
  if the user always replies "go" without engaging, the cost is paid with no benefit. Shipped
  on by default anyway because that friction is the literal feature being requested — a
  pause that's actually enforced — but it's a deliberately higher-friction default than its
  siblings and is called out as such here rather than left implicit.
- **Neutral:** Claude-Code-specific, same as ADR-0029/0030; Codex/Cursor installs
  unaffected. Rides along with `--native-memory-override`'s existing `--minimal` gating, so
  a `--minimal` install stays hook-free unless the relevant flags are passed explicitly.

## References

- `packages/create-obsidian-memory/src/hooks/guard-effort-gate.mjs`
- `packages/create-obsidian-memory/src/claude-native-memory.mjs`
  (`mergeEffortGateHook`, `effortGateHookCommand`, `configureClaudeNativeMemory`'s
  `effortGate` option)
- `packages/create-obsidian-memory/test/claude-native-memory.test.mjs`
- ADR-0030 (the enforcement-hook precedent this extends); Claude Code `PreToolUse` hook
  contract (`hookSpecificOutput.permissionDecision`)

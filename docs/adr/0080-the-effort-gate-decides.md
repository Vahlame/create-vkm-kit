# ADR-0080: The effort gate decides, persists, and interrupts once

- **Status:** Accepted (supersedes the protocol half of [ADR-0031](./0031-effort-gate-hook.md))
- **Date:** 2026-07-27
- **Deciders:** maintainer

## Context

ADR-0031 made a pause real: a `PreToolUse` hook denied a session's 2nd+ substantive edit
until the model printed a `[!] EFFORT RECOMMENDATION` block and a genuine user turn
followed it. The mechanism worked. The protocol around it did not.

**It wedged autonomous sessions.** The gate opened only when that block parsed AND its
level matched `$CLAUDE_EFFORT`. Any drift — a rephrased heading, an unset env var, a
transcript flushed late — left the session denied with nobody around to reply. Recorded in
`KNOWN_FAILURES.md` on 2026-07-11, 07-19 and 07-25, and it happened a fourth time to the
session that wrote this ADR.

**It also asked the user to do the thinking twice**: read a proposal, then type the command
themselves. The hook had already gathered everything needed to make the call.

What the platform allows was measured on 2026-07-27 against Claude Code 2.1.219, not
assumed:

| Lever                                  | Result                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `effort.level` on the hook payload     | Present and authoritative — the level after any model-forced downgrade                        |
| `effortLevel` written to settings.json | **No effect on the running session** (35 consecutive tool calls kept reporting the old level) |
| Any hook output field                  | No way to set model or effort — the reference documents reading them only                     |
| `model` on a hook payload              | `SessionStart` only, and "not guaranteed to be present"; there is no `$CLAUDE_MODEL`          |
| UIA on the desktop app                 | The prompt is a Group with TextPattern — read-only, nothing to `SetValue`                     |
| `PostMessage(WM_CHAR)` to the renderer | Types correctly **only while the window is active**; minimized, not one character arrived     |

The last two matter because the obvious wish — "apply it in the background while I work
elsewhere" — is not available on this platform: Chromium accepts keyboard input only when
its window is active, so applying it without asking and never taking the user's foreground
cannot both be true.

## Decision

The gate stops asking and starts deciding.

1. **Score the work** from what the hook can observe: the files this session touched, the
   path they live in (auth/crypto/migrations vs. prose), how many, the size of the edit,
   and which way the user's own words push the stakes. Deterministic, explainable, no model
   call — it runs on every edit.
2. **Persist** the resulting `effortLevel` (and `model`) into `~/.claude/settings.json`, so
   the next session simply starts there. This is what that key is for.
3. **Interrupt at most ONCE per session**, tracked in `~/.vkm/effort-gate/<session_id>.json`
   — a file, not a transcript inference. The message names the level, the reason, and the
   one command that applies it; when the recommendation already matches the session, there
   is no interruption at all.
4. **Never `fable`**: it is never recommended, and a session already on it keeps its model.
   Downgrades in general require `VKM_EFFORT_ALLOW_HAIKU=1`.
5. **Optionally apply it by typing** (`VKM_EFFORT_APPLY=keys`): a sibling script issues
   `/model` and `/effort` through the Chrome DevTools Protocol when the app was started
   with a debugging port (`scripts/claude-desktop-debug.ps1`), and otherwise via SendKeys
   **only when the Claude window is already in front**. A decision that could not be
   applied stays queued and is retried on later edits, so it lands the moment the user is
   back in the window without them typing anything.

## Alternatives considered

- **Keep the proposal protocol, fix the parser.** Rejected: every fix would have made the
  parse stricter, and the failure mode is a session that never unblocks. Four incidents on
  one mechanism is a design verdict, not a parsing bug.
- **Write `effortLevel` and claim it applied.** Rejected on measurement — it does not, and
  a kit that exists to stop "green that proves nothing" cannot ship "applied that did not."
- **Steal focus to type the command.** Rejected by the user, and correctly: pulling someone
  out of the app they are working in is worse than an un-applied effort level.
- **Drive the app through UI Automation in the background.** Rejected on measurement: the
  prompt exposes no `ValuePattern`, and posted characters are dropped while the window is
  inactive.
- **Always downgrade cheap work to a smaller model.** Rejected as a default: the failure it
  produces is fluent and wrong, and the user is the one who should accept that trade.

## Consequences

- Positive: an autonomous session can no longer be wedged by this hook — the worst case is
  one paragraph of text. The common case (already at the right level) costs nothing: no
  write, no output. The decision survives the session even when nobody reads the message.
- Negative: the scoring is heuristic and will sometimes be wrong; it interrupts once to say
  so, which is a real (bounded) cost. The typing applier needs an opt-in and, for the
  background case, a debugging port that widens the app's local attack surface — off by
  default, documented where it is enabled.
- Neutral: the marker/confirmation transcript scan is gone. `scanTranscript` now returns
  the files and stakes the score needs, which is what the sidecar cache carries.

## References

- [ADR-0031](./0031-effort-gate-hook.md) — the pause this replaces (its mechanism, not its protocol)
- [ADR-0030](./0030-deterministic-enforcement-hooks.md) — same "a rule the model can skip is not a rule" reasoning
- [ADR-0078](./0078-allocate-and-hide-a-console.md) — why the applier inherits a hidden console instead of setting `windowsHide`
- `packages/create-vkm-kit/src/hooks/guard-effort-gate.mjs`, `.../apply-model-effort.mjs`, `test/effort-gate.test.mjs`

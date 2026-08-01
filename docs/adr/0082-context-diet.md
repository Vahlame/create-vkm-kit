# ADR-0082: Context diet — the fixed layer pays rent per token

- **Status:** Accepted
- **Date:** 2026-08-01
- **Deciders:** maintainer

## Context

The kit's fixed context layer — the managed rules block (loaded on ~2 surfaces per Claude
Code session), the `SessionStart` reminders, skill descriptions, MCP schemas — is a
permanent prior every session pays as input tokens on **every turn**. Measured with
`scripts/context-budget.mjs` before this ADR: **45,603 always-chars ≈ 11,401 tokens** (es).

Two items were prose-heavy out of proportion to what they instruct:

- The rules block (`memory-rules.mjs`): `memory` 4,626 / `doctrine` 3,141 chars (es) —
  full paragraphs where the rules themselves are one-liners.
- The `SessionStart` `reminders()` (1,335 chars es) — a **deliberate** duplication of the
  rules block (ADR-0035), written when the rules block could not be assumed present.
  Today the installer writes the block into `~/.claude/CLAUDE.md` on every wired install,
  so the duplication buys redundancy, not reach.

The user this kit serves asked for the same tasks at materially lower token cost, with
quality held or improved.

## Decision

1. **Compress `memory` and `doctrine`** to roughly 60-70% of their size (es:
   4,626→3,248 and 3,141→1,936) with every load-bearing rule kept **verbatim** — the
   `LOAD_BEARING` phrase gate in `memory-rules-budget.test.mjs` is the proof, not a
   promise. `core` (the safety level) is untouched.
2. **Slim `reminders()`** to a compact restatement of the hard rule plus four operational
   one-liners (es: 1,335→740 chars), superseding ADR-0035's full duplication.
3. **Tighten the budgets** in `memory-rules-budget.test.mjs` to just above the new sizes,
   so the diet cannot silently revert — growth is a reviewed decision again.
4. Result, same measurement: **42,425 always-chars ≈ 10,607 tokens** — about **800 tokens
   saved per session-turn prefix** before any conversation happens, plus the same again on
   every surface re-read.

## Alternatives considered

- **Change `DEFAULT_PROFILE` to `standard`** (drop `doctrine` by default). Rejected for
  now: doctrine carries the token-terseness and minimal-code rules that themselves save
  output tokens; removing them to save input tokens is trading a measured save for an
  unmeasured loss. Compression keeps both.
- **Delete the reminders entirely.** Rejected: `SessionStart` context is the only injection
  that reaches sessions in projects whose own `AGENTS.md` was never wired; one compact
  restatement of the hard rule is the difference between "redundant" and "unprotected".

## Consequences

- Positive: ~7% of the fixed layer gone with zero rules dropped (phrase-gated); tightened
  ceilings turn the diet into an invariant.
- Negative: terser rules text leans harder on the model to unpack dense bullets; if a rule
  starts being missed in practice, the fix is re-expanding THAT rule, not the block.
- Neutral: docs install pages and `AGENTS.md` re-embedded from the canonical source; the
  drift gates already forced that.

## References

- ADR-0035 (reminders duplication — superseded in part), ADR-0036/0067 (budget gates)
- `packages/create-vkm-kit/src/memory-rules.mjs`, `src/hooks/session-start-vault-context.mjs`,
  `test/memory-rules-budget.test.mjs`, `scripts/context-budget.mjs`

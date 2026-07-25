# ADR-0066: Harness conformance matrix — what the kit delivers per agent, and where it stops

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** maintainer

## Context

"Cross-platform" in this repo has always meant **operating system**. `e2e-smoke.mjs`
installs with `--ide none` and proves the stack works over stdio on Windows, macOS and
Linux. It has never asked the other question: does wiring **Codex**, or **Cursor**, or
anything that is not Claude Code, produce a working install?

The README advertises the kit for Claude Code, Codex, Cursor, Cline, Continue and
Copilot. Nothing verified any of those but the first, and one structural fact makes
that gap worse than a missing test: **every deterministic guarantee the kit has is a
Claude Code hook.** The `SessionStart` injection, the native-memory write guard, the
close-ritual nudge, the effort gate, the token-saver compaction, the `vkm-terse`
output style — all install into `~/.claude/` (`claude-native-memory.mjs:305-309`,
`token-saver.mjs:83-89`). Outside Claude Code the kit is an MCP server plus a prose
block, and every rule in that block depends on the model choosing to follow it.

That is a real architectural asymmetry, and the honest response is to publish it, not
to let a generic "cross-platform" claim imply otherwise.

## Decision

Ship `scripts/harness-matrix.mjs`: per harness, run a **real install** into a
throwaway HOME/cwd and assert the config artifact that harness actually reads. Wired
into the existing `e2e-smoke` CI job, exiting non-zero on any broken wiring cell.

The design rule that matters most is what the probe does when it _cannot_ know:

> A cell whose CLI is absent reports `not-installed` — **not** a pass, **not** a
> failure, and never inferred from the wiring cell next to it.

A matrix that turns an absent CLI into a green tick is worse than no matrix: it is a
claim nobody checked, wearing the costume of evidence. So cells come in two classes
with deliberately different evidence value — **wiring** (filesystem, runs anywhere,
every harness) and **live** (needs the CLI, honestly unmeasured when missing).

The matrix carries a column for **deterministic enforcement**, which is where the
architectural finding lives rather than in prose someone has to notice.

Scope is deliberately narrow: `--minimal`, no Python, no git. Whether retrieval works
is `e2e-smoke.mjs`'s job; duplicating it here would make the matrix slow and flaky for
no extra information.

**Which edge of the control loop this closes:** none — like ADR-0063 it is
instrumentation. It is the precondition for deciding which guarantees must move out of
Claude-Code-only hooks and into the MCP server, which is where every harness can see
them.

## Alternatives considered

- **Drive each harness's real CLI.** The strongest evidence, and the eventual goal —
  but it cannot run in CI (no Codex/Cursor binaries) and would make the matrix a
  machine-dependent test. Split instead: wiring runs everywhere, live is reported
  honestly. The `live` column is the slot those results land in when the CLIs exist.
- **Assume wiring implies working.** Rejected outright; it is the exact failure this
  ADR exists to prevent.
- **Fold this into `e2e-smoke.mjs`.** Rejected: that script answers "does the stack
  work on this OS", this one answers "does it wire up for this harness". Same job in
  CI, separate scripts, because conflating them is how the second question stayed
  unasked for so long.
- **Publish the matrix by hand in the README.** Rejected — a hand-maintained matrix
  is a claim that rots. This one is regenerated and gated.

## Consequences

- Positive: the multi-harness claim is now checked for wiring on every CI run, and the
  Claude-Code-only nature of the enforcement layer is stated in the artifact itself.
- Positive: a concrete baseline for the question "how much of the kit's benefit
  survives a change of harness?" — currently unanswerable, and the matrix names
  exactly which cells would answer it.
- Negative: the `live` column is mostly unmeasured today. That is the true state; a
  filled-in column would require fabricating results, which is worse.
- Neutral: adds ~4 real installs to the `e2e-smoke` job.

## References

- `scripts/harness-matrix.mjs`, `scripts/e2e-smoke.mjs`
- `packages/create-vkm-kit/src/rules-merge.mjs:88,95,100,105` (the four rules surfaces)
- `packages/create-vkm-kit/src/claude-native-memory.mjs:305-309`, `token-saver.mjs:83-89`
  (the enforcement layer, and why it is Claude-Code-only)
- ADR-0063 (fixed-layer inventory — the other half of "measure before deciding")

# ADR-0043: token-saver — conservative PostToolUse output compaction with a hard must-keep guarantee

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** maintainer

## Context

Noisy tool output is one of the last unmanaged token drains in a Claude Code session: a single `npm install` or test run can inject thousands of lines of progress bars, ANSI repaints and repeated status lines into context, where they are paid for on **every subsequent turn**. Claude Code's `PostToolUse` hook can rewrite a tool result before it enters context via `hookSpecificOutput.updatedToolOutput` — a sanctioned interception point. The risk is symmetrical: a compactor that ever drops the one line Claude needed (the error) converts a token saving into a debugging disaster. So the design constraint is not "maximum compression" but "compression whose failure modes are provably bounded".

## Decision

Ship two `PostToolUse` hooks in `create-obsidian-memory`, on by default, plus supporting pieces:

1. **`compact-tool-output.mjs` (matcher `Bash`)** applies conservative, mechanical passes only: ANSI escape stripping; `\r` progress repaints reduced to their final frame (what a terminal would show); runs of ≥3 identical lines collapsed to one plus a repeat marker; outputs over 200 lines windowed to head (120) + tail (60) with an elision marker, **rescuing** diagnostic lines from the elided middle (cap 40). A **hard must-keep guarantee** — any line matching the error/warn/fail/exception/exit-code family (`MUST_KEEP_RE`) and the final lines survive verbatim — is enforced by tests, alongside a CI gate of **≥30% reduction on the noisy fixture with zero diagnostic loss**. Outputs saving under 500 chars are left untouched (the hook prints nothing).
2. **`compact-mcp-output.mjs` (matcher `mcp__.*`)** is strictly **whitespace-only**: it re-serializes pretty-printed JSON tool results into compact form and nothing else — parsed data is byte-identical after `JSON.parse`, so the `_trust` untrusted-data envelope (ADR-0018/0040) survives exactly.
3. **Shape preservation and fail-open everywhere:** `updatedToolOutput` always matches the incoming `tool_response` type (string→string, object→object with only text fields compacted), so a schema mismatch can never corrupt a result; any internal failure emits nothing and Claude Code keeps the original. `VKM_TOKEN_SAVER=0` is a runtime kill switch, `--no-token-saver` the install-time opt-out, `--uninstall` fully symmetric.
4. The same module installs `permissions.deny` read rules for token-hungry artifacts (`node_modules/**`, `**/dist/**`, lockfiles) and the `vkm-terse` output style — the style's doctrine role is ADR-0049's subject.

## Alternatives considered

- **`PreToolUse` command rewriting (e.g. auto-appending `--quiet`/`2>/dev/null`):** rejected — it changes what the user's command _does_, breaks intent in unforeseeable ways (a user debugging verbose output would have it silently suppressed at the source), and saves nothing on tools whose verbosity isn't flag-controlled.
- **LLM-based summarization hook:** rejected — a model call per tool result costs latency and roughly what it saves, adds a new failure mode (hallucinated summaries of logs) to a path that must be boring, and is unauditable compared to mechanical passes whose invariants are testable.
- **Restructuring MCP JSON (dropping fields, truncating arrays):** rejected for the MCP hook — the kit's own tools carry security-relevant envelopes; whitespace-only is the only rewrite that is provably lossless.

## Consequences

- Positive: measured ≥30% context reduction on noisy shell output with a test-gated zero-loss guarantee on diagnostics; savings compound across every later turn of the session; every piece is independently reversible.
- Negative: a hook now sits on the hot path of every Bash and MCP tool result — bugs here have blast radius, which is why the invariants are CI gates rather than review promises; genuinely novel diagnostic formats not matching `MUST_KEEP_RE` could be windowed out of a >200-line middle section (mitigated by head+tail+rescue and the kill switch).
- Neutral: small or already-clean outputs pass through untouched, so well-behaved tools see no change at all.

## References

- `packages/create-obsidian-memory/src/hooks/compact-tool-output.mjs` (`MUST_KEEP_RE`, DEFAULTS), `src/hooks/compact-mcp-output.mjs`, `src/token-saver.mjs` (installer, deny rules, `vkm-terse`).
- ADR-0032 (token-economy method: claims become measured gates), ADR-0035 (fixed-cost diet this extends to tool output), ADR-0049 (the terse style's doctrine placement).

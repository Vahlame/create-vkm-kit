# ADR-0063: Fixed-context budget inventory (measure the permanent prior before touching it)

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** maintainer

## Context

The kit's **fixed layer** is every character an agent pays at the start of every
session, before it calls a single tool: the memory-rules block, the MCP servers'
tool schemas, the `SessionStart` injection, skill and sub-agent descriptions, the
output style. Two of those pieces are already gated as reviewed decisions —
`schema-budget.test.mjs` (ADR-0035, vault schemas) and `memory-rules-budget.test.mjs`
(ADR-0036, rules block). The rest never had a number attached to it.

That matters more than the token cost, and this is the point the earlier ADRs left
implicit: the fixed layer is a **permanent behavioural prior**. It applies to every
session, including the ones the kit was never designed for. A number that nobody
measures cannot be traded off against the behaviour it buys, and cannot be shown to
be harmless. Before any redesign of that layer, it has to be inventoried: piece by
piece, attributable to a `file:line`, split into what is paid ALWAYS versus only
when something triggers.

Measuring it surfaced three things the working estimate had wrong:

1. **`obscura-web`'s schemas are the single largest piece of the fixed layer** —
   18,167 chars across 11 tools, larger than the vault's 22 tools (10,748) — and
   they are wired by the **default** install (`index.js:956`, `--full` is the
   default) with **no budget gate** on them at all.
2. **The rules block is paid more than once.** Under `--full`, `rulesFromIdes`
   (`index.js:234-240`) writes it to project `AGENTS.md`, `~/.claude/CLAUDE.md`
   and `~/.codex/AGENTS.md` (`rules-merge.mjs:88,95,100`). A Claude Code session
   opened inside an installed project loads the first two **together** — 9,375
   chars charged twice.
3. **The shipped schema gate silently depends on an unverified property.** Its
   regex (`schema-budget.test.mjs:35`) matches only the first literal of a
   description; `obscura-mcp.mjs` and `downloads-mcp.mjs` write nearly every
   description as `"a" + "b" + "c"`. The gate is honest today only because
   `hybrid-mcp.mjs` happens to have no concatenation — a refactor to concatenated
   strings would drop the measured total to near zero **without failing anything**.

Totals, `es`, this checkout: **45,247 chars ≈ 11,312 tokens always**, 76,891 ≈
19,223 worst case (all four skills loaded, sub-agent spawned, one full
`assemble_context`), plus a second 9,375 in the two-surface case above.

## Decision

Ship `scripts/context-budget.mjs`: an inventory that measures the fixed layer from
this checkout (repo view) or from a real install (`--home` / `--cwd`), emitting a
`piece → chars → tokens → file:line → when` table as markdown or `--json`. `when` is
one of `always` / `on-trigger` / `on-call` / `opt-in`, so the permanent prior is
separable from what a session opts into. Its schema extractor **follows `+`
concatenation**, and a test pins that it agrees exactly with the shipped gate's
regex where no concatenation exists — making it a strict superset, not a competing
measurement.

`packages/create-vkm-kit/test/context-budget.test.mjs` records the result as a
**tripwire, not a budget**: it pins the composition (every always-paid piece
present, classified, attributable) exactly, and the totals within a ±20% band. A
doubling fails the build; trimming a description does not.

Turning the band into a real budget is deliberately deferred. Picking a ceiling now,
before the off-target control (WP1) says what the fixed layer actually costs in
behaviour, would be inventing a number — the mistake ADR-0035 avoided by measuring
first and gating second.

**Which edge of the control loop this closes:** none yet — it is the precondition of
② DOSE. Dosing context per session is not implementable while the thing being dosed
is unmeasured.

## Alternatives considered

- **Gate the total now, at the measured value.** Rejected: it freezes an
  accidental number as policy. The right ceiling is the one justified by the
  behavioural evidence, and that evidence does not exist yet.
- **Extend `schema-budget.test.mjs` to obscura/downloads instead of a new tool.**
  Rejected as the _primary_ move: it would gate three servers while still leaving
  the rules block, the hook injection, the skills and the output style unmeasured —
  and the surface-multiplier finding would have stayed invisible, since it is not
  visible from any single source file.
- **Measure by spawning each MCP server and reading its advertised schema.**
  Rejected: it needs a live Python backend and a built vault for the vault server,
  which makes the baseline non-deterministic and unrunnable in the blocking CI job.
  A source parse is dependency-free, and the 1:1 anchor-to-string assertion pins
  that it is not quietly missing anything.
- **Count the rules block once regardless of surfaces.** Rejected: it is the
  measurement that hides the largest single avoidable cost in the inventory.

## Consequences

- Positive: the fixed layer has a number, per piece, with `file:line`. The two
  ungated MCP servers are now visible in the same table as the gated one. The
  surface multiplier is measurable on a real install rather than argued about.
- Positive: the schema gate's hidden fragility is now asserted rather than assumed.
- Negative: two overlapping measurements of the vault schemas now exist (this
  inventory and ADR-0035's gate). Kept on purpose — the gate is a budget with a
  reviewed ceiling, this is an inventory with a band; a test pins that they agree.
- Neutral: no behaviour changes. Nothing is installed, removed or resized by this
  ADR; `npm run lint`, `npm run typecheck` and `npm test` (1,080 tests) are green
  unchanged.

## References

- `scripts/context-budget.mjs`, `packages/create-vkm-kit/test/context-budget.test.mjs`
- ADR-0035 (tool-schema budget gate), ADR-0036 (rules-block budget gate)
- `index.js:234-240` (`rulesFromIdes`), `rules-merge.mjs:88,95,100,105` (surface paths)
- Mission document §8 WP0; the loop in §2.2

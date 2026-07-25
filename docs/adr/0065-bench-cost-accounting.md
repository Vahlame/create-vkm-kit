# ADR-0065: Cost accounting in every bench run

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** maintainer

## Context

Every live-LLM bench in this repo measures Δquality. None of them measures what that
quality cost. So these two outcomes have been reported identically:

- the kit wins by 20 points, and
- the kit wins by 20 points while spending 3× the tokens and tripling the tool calls.

For a kit whose central claim is token efficiency, that is the wrong thing to be
blind to. `token-quality-ab` measures savings, but on a separate axis, in a separate
run, for one mechanism at a time — never as "what this quality gain cost" in the same
cell that produced the gain.

The instrumentation was almost there and nobody used it. `runSubject` has always
returned `usage` from `claude -p --output-format json`, and all four call sites are
written `const { answer } = await runSubject(...)`. The data arrived and was dropped
one line later.

Separately, `vkm-doctor` has aggregated real-session token totals from local OTLP
since ADR-0044. There was no way to compare it against a bench number, because the
bench had no number to compare.

## Decision

`runSubject` returns a normalized `cost` alongside `answer`:

```js
{ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
  totalTokens, turns, costUsd, wallClockMs }
```

and all five bench runners carry it — on the emitted JSONL row for the four that
write rows, in the printed cell summary for `discipline-bench`. Cost now travels with
the score, so a past run can be re-read for cost without re-running anything.

Three decisions inside that, each with an obvious wrong alternative:

1. **Unreported is `null`, never `0`.** An agent CLI that reports no usage yields
   nulls, and `aggregateCost` refuses to average a cell where any run is missing a
   field. Averaging 100 and "unknown" to 50 produces a number that looks like a
   measurement and isn't — and it would read as _cheaper_, biasing exactly toward the
   flattering conclusion.
2. **`wallClockMs` is measured by the runner, not read from the CLI**, so latency is
   available for any agent — including `codex exec` and any future bridge — even when
   token counts are not.
3. **`totalTokens` excludes cache tokens.** They are billed differently; folding them
   in would double-count and inflate every cost claim.

`costEfficiency()` produces the Δquality/Δtokens column: quality bought per 1,000
extra tokens. A gain at zero token cost reports `qualityPerKToken: null`, not
`Infinity` — "free" is a real answer and deserves its own representation.

`toTelemetryTotals()` re-keys a cell into the exact shape `vkm-doctor` aggregates OTLP
into (`{ input, output, cacheRead, cacheCreation }`, `costUSD` —
`packages/vkm-doctor/src/doctor.mjs:38`), with a test pinning the vocabulary. That is
the join: lab cost and real-session cost in the same units.

**Which edge of the control loop this closes:** ⑦ LEARN. A feedback loop that cannot
see cost can only ever optimise for quality at any price.

## Alternatives considered

- **Parse tool calls out of the transcript for an exact count.** Rejected for now:
  it means depending on Claude Code's transcript format, which the effort-gate hook
  already had to chase across versions. `num_turns` is a coarser proxy that comes
  from a documented output contract; when a bench needs true tool-call counts, the
  transcript reader belongs behind its own interface.
- **Report cost only in `token-quality-ab`.** Rejected — that is the current state,
  and it is why a quality win's price is invisible everywhere else.
- **Estimate tokens from character counts** (the `chars / 4` estimator used for the
  fixed-layer inventory). Rejected here: it is right for static text the kit ships,
  and wrong for a live run where the real number is available for free.
- **Fail a bench when cost is unreported.** Rejected: it would make every non-Claude
  agent CLI unusable as a subject, which runs against the multi-harness direction of
  the wider work. Unknown is reported as unknown.

## Consequences

- Positive: any future bench answers "did it win, and what did it cost?" from one run.
  The off-target control's secondary metrics (tokens, turns, latency) are available
  before that bench is written.
- Positive: bench cost and `vkm-doctor`'s real-session cost are directly comparable.
- Neutral: no bench was re-run here, so no existing `RESULTS.md` gains a cost column
  yet — the next round of each bench populates it. Saying so plainly is the point;
  a column of retroactively-estimated costs would be worse than an empty one.
- Neutral: a pre-existing constraint is now documented rather than discovered —
  `agentCmd` is split on whitespace, so no single argument may contain a space.

## References

- `evals/lib/subject-runner.mjs`, `evals/lib/subject-runner.test.mjs`
- `packages/vkm-doctor/src/doctor.mjs:38` (the telemetry totals shape)
- ADR-0044 (local OTLP telemetry), ADR-0064 (the reporting rule these numbers feed)

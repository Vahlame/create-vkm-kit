# ADR-0038: Evolutive memory loop — learn from failures, reinforce what helps, decay what doesn't

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** maintainer

## Context

The kit saved tokens and recalled notes well, but "memory" was static: lessons lived wherever the agent happened to write them, nothing privileged a recorded failure when the same task came back, promotion of hypotheses to confirmed practices existed only as prose in the rules block, and no signal distinguished memory that actually helps from memory nobody ever touches. The maintainer's ask: the agent should **constantly improve its answers by learning from mistakes and from the user — always evolutive — with minimal new dependencies**.

Constraints: Markdown stays the source of truth; everything user-facing stays propose-then-human-approve (the kg-suggest/report/extract precedent); the MCP schema budget (ADR-0035) is nearly spent, so new capability must ride output fields, CLI flags and env vars, not new tools.

## Decision

Ship the loop as five small, deterministic pieces — **telemetry in SQLite, truth in Markdown**:

1. **Capture** — `memory_extract_candidates` classifies each candidate (`failure | gotcha | preference | decision | fact`, bilingual heuristics in `extract.mjs`) and suggests a target note; failures dedup against `KNOWN_FAILURES.md`. The rules block teaches a structured entry: `## <symptom>` + `- [failure] … #tag` / `- [root_cause] …` / `- [fix] …` — instantly queryable via `vault_observations(category:'failure', tag:…)` with zero parser changes (ADR-0023 does the work).
2. **Recall** — opt-in `pin_failures` lever in `hybrid_search`: a fourth low-weight RRF ranking (0.15, the GRAPH_WEIGHT doctrine from ADR-0021) of already-matched notes carrying `[failure]`/`[gotcha]` observations. Lessons edge out neutral ties; off-topic failure notes are never imported. CLI `--pin-failures` or `OBSIDIAN_MEMORY_PIN_FAILURES=1`.
3. **Measure** — the retrieval bench gains a `failure-recall` slice (task-phrased queries whose relevant note is `KNOWN_FAILURES.md`) and CI runs the gated bench twice, baseline and lever-on. "A recorded mistake is recalled on the next matching task" is a regression-fails-CI claim, per the ADR-0020/0021 method.
4. **Reinforce & decay** — a `recall_log` telemetry table (non-derived; survives reindexes) records `returned` (search surfaced it) and `used` (agent then opened it) events. The opt-in `usage` lever boosts notes that demonstrably helped (bounded, log-damped; empty log = exact no-op). `vault_memory_report` surfaces `cold_notes` — indexed long enough, never returned nor opened — as archive candidates; **no telemetry means no cold claims** (absence of data is not evidence of disuse), and nothing is ever auto-deleted.
5. **Reflect** — `memory-reflect` (CLI pair + `vault_memory_report({reflect:true})`) generates the consolidation proposals the rules only described: pending `PRACTICES/observations.md` lines past their review window → confirm/dismiss; near-duplicate pairs → merge candidates; stale `status: hypothesis` notes (a frontmatter convention `vault_audit` now checks, with `last_verified`) and orphans → verify/link/archive proposals; plus a SESSION_LOG recent-activity digest. `--write-note` renders them to `_meta/reflection-YYYY-MM-DD.md` for human review (the `rotate-log` write precedent).

## Alternatives considered

- **New MCP tools (`memory_log_failure`, `memory_feedback`, standalone `memory_reflect`):** rejected — each costs schema budget every session for every wired agent; classification + implicit read-after-return + the report fold-in cover the same ground at zero schema cost. Revisit with usage data.
- **Auto-applying promotions/merges/decay:** rejected — the vault is the user's; a wrong auto-merge or auto-archive is the corruption ADR-0037 promises not to cause.
- **LLM-driven reflection (clustering, NLI contradiction detection):** rejected for the engine — stdlib-deterministic proposals are testable and free; the _agent_ reading the proposals supplies the intelligence.
- **Learned ranking weights:** rejected — the levers stay fixed, bounded multipliers/fusion weights so ranking remains deterministic and mechanism-testable (ADR-0027 doctrine).

## Consequences

- Positive: a closed loop — mistakes get structured once, resurface on matching tasks (measured in CI), helpful memory climbs, unused memory surfaces for review, and hypotheses have a driven path to confirmed-or-archived.
- Negative: recall telemetry is a new local data category (paths + timestamps in the sidecar DB); it never leaves the machine, is prunable (1y auto), and `OBSIDIAN_MEMORY_RECALL_LOG=0` disables it.
- Neutral: every lever is off by default; the default ranking path stays byte-identical (asserted by tests and the unchanged baseline bench gate).

## References

- ADR-0020/0021 (measured retrieval, weighted-RRF tuning), ADR-0023 (observations infra), ADR-0024 (report substrate), ADR-0027 (bounded deterministic levers), ADR-0035 (schema budget), ADR-0037 (system-of-record boundary)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/{reflect,recall_log}.py`, `query.py` (pin_failures/usage), `extract.mjs`, `evals/retrieval` failure-recall slice

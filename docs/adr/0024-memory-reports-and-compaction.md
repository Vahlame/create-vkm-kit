# ADR-0024: Memory reports — indices, hygiene, and compaction candidates

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** maintainer

## Context

A vault that grows without tending degrades: `SESSION_LOG` balloons, notes drift
past the token budget, links break, observations pile up uncategorized, and notes
become orphaned or redundant. The kit already had the _primitives_ to notice some
of this — `audit` (oversized notes, broken `[[wikilinks]]`, log size) and
`rotate-log` (archive old log sections) — but no single, high-signal view of vault
state, and nothing that used the structured graph (ADR-0023) or the embeddings.

The request: "periodically condense old notes, detect contradictions, build
automatic indices and memory reports." Two parts of that need care:

- **"Detect contradictions"** in the general case is semantic NLI — not something a
  dependency-free engine can do honestly. Claiming it would be an overclaim.
- **"Condense old notes"** must not mean _auto-rewriting the user's notes_. The
  vault is the user's; the kit's discipline (ADR-0023's `kg_suggest`) is to
  propose, not mutate.

## Decision

Add one **read-only aggregation**, `report.py`, exposed as `memory-report` /
`json-memory-report` and the `vault_memory_report` MCP tool. It composes existing
signals into a single digest:

- **Automatic indices:** observations by category, relations by type, top inline
  `#tags`, and the graph's **hub notes** (highest in+out link degree) — a
  no-upkeep map of what the vault knows and how it connects.
- **Hygiene / compaction candidates:** oversized notes, broken links and
  `SESSION_LOG` bloat (from `audit`), plus **stale notes** (untouched beyond a
  threshold) and **orphan notes** (no relations in or out). Plus `suggested_actions`
  — concrete next steps (run `rotate-log`, split note X, link the orphans).
- **Review candidates (opt-in, needs embeddings):** the most similar **note pairs**
  by cosine, surfaced as _candidates to review_ for redundancy or contradiction —
  explicitly **not** a contradiction-detection claim. A human or the agent judges.

It is **read-only**: it identifies what to condense/split/link/rotate, but the
actual condensation is done by the agent (LLM) with the human's confirmation,
written through the normal edit tools / `rotate-log`. The engine never rewrites a
note. "Periodically" is the caller's job — the agent runs it at the close ritual or
the user schedules it (the Go daemon could later run it on a timer); baking a
scheduler into the stdlib RAG engine is out of scope.

## Alternatives considered

- **LLM-based summarization/contradiction detection inside the engine:** rejected.
  The RAG engine is deterministic and dependency-free by design (ADR-0017); calling
  a model from it would break that and couple it to a provider. The agent already
  _is_ the LLM — detection here, summarization there, writes gated by the human.
- **Auto-condensing old notes (engine rewrites them):** rejected — violates "the
  vault is the user's" (ADR-0023). The report flags candidates; the human approves.
- **A persisted, incrementally-maintained report table:** rejected as premature.
  The report is cheap to compute on demand from the already-fresh index; caching it
  adds invalidation complexity for a digest a user runs occasionally.

## Consequences

- **Positive:** one command gives an actionable health + structure overview that
  uses everything the kit indexes (FTS + KG + vectors). On the real 55-note vault it
  immediately surfaced SESSION_LOG over budget, 6 oversized notes, 13 broken links,
  8 orphans, and the true graph hubs — none previously visible in one place. Honest
  about its limits: duplicate pairs are review candidates, not verdicts.
- **Negative:** the opt-in near-duplicate scan is O(n²) over note vectors; it is
  capped (skipped above a note count) and off by default. A blocked/embedding-less
  vault simply omits that section.
- **Neutral:** stale/orphan thresholds are tunable; the report makes no change on
  its own, so a noisy suggestion costs nothing but a glance.

## References

- ADR-0017 (embeddings), ADR-0018 (`audit`/`rotate-log` token hygiene), ADR-0023
  (the relations/observations the indices read)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/report.py`
- `packages/obsidian-memory-mcp/src/hybrid-mcp.mjs` — `vault_memory_report`

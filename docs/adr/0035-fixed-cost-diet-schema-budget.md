# ADR-0035: Fixed-cost diet — tool-schema budget gate, compact KG defaults, compressed session hook

- **Status:** Accepted
- **Date:** 2026-07-03
- **Deciders:** maintainer

## Context

ADR-0034 cut the **per-call** cost of recall. What remained unmeasured was the
kit's **fixed** cost — tokens every wired agent pays every session before any
tool is even called:

1. **Tool schemas.** The MCP's 14 tool descriptions + parameter descriptions +
   server `instructions` measured **10,226 chars (~2.5K tokens)**, injected
   into every session of every wired agent. Much of it was operator prose
   (env-var configuration, `Returns {...}` shapes the result already shows,
   repeated vault-root boilerplate ×9).
2. **Knowledge-graph defaults.** `vault_relations` / `vault_observations`
   shipped with default `limit: 200` — the exact pattern ADR-0034 just fixed
   in search (a default sized for the worst case, paid on the common case).
3. **The SessionStart hook** dumped the first 4,000 chars of the curated
   index verbatim: full multi-sentence prose for early entries, and any
   entry past the cut **silently invisible** to the session — on the
   reference vault, 40 of the index's 63 entries were missing from the map.

## Decision

Three cuts, each measured, the first one gated:

1. **Schema diet + budget gate.** Trim descriptions to what changes agent
   behaviour (when to use, contracts, security semantics — all kept verbatim;
   operator config and redundancy cut). Measured: **10,226 → 7,641 chars
   (−25%, ~−650 tokens per session per agent)**. A new test
   (`schema-budget.test.mjs`) parses the source and **fails the build** if
   total schema text exceeds 8,000 chars or any single description exceeds
   450 — schema bloat becomes a reviewed decision, not a drive-by tax (the
   same measured-and-gated doctrine as `bench-tokens`, applied to the kit's
   own fixed cost).
2. **KG defaults 200→50** on `vault_relations` / `vault_observations` (MCP
   surface only; CLI/API keep 200). Descriptions teach the alternative:
   filter by category/tag/note instead of raising the limit.
3. **Compress the index, don't truncate it.** The hook now caps **each entry**
   (bullet) at 100 chars with a word-boundary cut, keeps headings, drops YAML
   frontmatter and over-cap prose whole (a mid-sentence fragment reads worse
   than absence), and only then applies a lowered 3,000-char backstop.
   Measured on the reference vault (10,433-char index, 63 entries):
   **4,000 → 3,142 chars (−21%) while pointer coverage rose from 23 to 39
   entries (+70%)** — cheaper and strictly more informative, because for a
   pointer map every entry's _name_ is worth more than any entry's third
   sentence.

## Alternatives considered

- **Trimming the hook's precedence reminders:** rejected. They deliberately
  duplicate the CLAUDE.md rules as reinforcement (ADR-0029/0030 — deterministic
  enforcement); adherence is not traded for tokens, same exemption as the
  `_trust` envelope in ADR-0034.
- **Measuring the schema budget by spawning the MCP server in the test:**
  rejected — a source-parse is dependency-free, fast, and the regex is pinned
  by an assertion on the minimum number of strings found (a refactor that
  breaks the regex fails loudly, not silently).
- **LLM-summarized index in the hook:** rejected — hooks are deterministic by
  design; a per-entry char cap achieves the goal with zero inference cost.
- **Dropping `Returns {...}` shapes from ALL descriptions but also from
  handler docs:** kept in code comments where useful; only the agent-facing
  schema pays per-session.

## Consequences

- Positive: every wired agent's per-session fixed cost drops ~650 tokens
  (schemas) + ~215 tokens (hook, reference vault) before counting any call;
  sessions see 39 pointers instead of 23 at that lower cost (the backstop
  still bounds the tax — the tail stays one `vault_read_file` away); KG pulls
  stop defaulting to 200 rows; CI fails on schema regrowth.
- Negative: descriptions are terser — if adherence on any tool measurably
  drops, the budget leaves ~360 chars of headroom to restore the missing
  clause (a deliberate, reviewed spend). Installed hooks refresh on the next
  `create-obsidian-memory` run; existing installs keep the old hook until
  then.
- Neutral: the budget numbers live in one test file; raising them is a
  one-line reviewed change, never silent.

## References

- ADR-0034 (per-call wire diet — this ADR is the fixed-cost counterpart),
  ADR-0032 (measured token economy), ADR-0029/0030 (why the hook reminders
  are exempt).
- Measurements: schema 10,226 → 7,641 chars (regex over `description:` /
  `.describe(` / `instructions:`); hook on the reference 10,433-char index
  (63 entries): 4,000 → 3,142 chars with 23 → 39 visible entries.

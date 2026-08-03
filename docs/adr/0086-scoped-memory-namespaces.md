# ADR-0086: Scoped memory namespaces — one vault, one index, a `scope` filter

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** maintainer

## Context

The kit is now routinely multi-agent: the `vkm-implementer` subagent executes delegated
specs, workflow orchestrations fan tasks out to sibling agents, and each of them
accumulates durable knowledge — what it can be trusted with, where it stumbles, which
gates it must run — with nowhere first-class to put it. Projects have had that place since
the beginning (`PROJECTS/<name>.md`); agents have not.

The tempting shape is a vault per agent: hard isolation, no leakage by construction. It is
also the shape [ADR-0074](./0074-cross-project-leakage.md) implicitly priced when it
studied cross-project leakage: fragmentation multiplies indexes, sync repos and daemons,
kills cross-referencing (`[[wikilinks]]` cannot cross a vault boundary), and buys
isolation that scoping over one index provides for the cost of a parameter. ADR-0074's own
finding cuts the other way too: the leakage it measured was an artifact of the fallback
embedder on a corpus too small to fail, so hard isolation is a solution whose problem is
unconfirmed.

What ADR-0074 declined and what ships here are **different premises**. 0074 declined a
`project:` filter as a _leak mitigation_ built on unfalsified evidence; that decision
stands, and the nightly probe it wired still owns the leak question. This ADR ships
`scope` as an _addressing capability_: "recall only this agent's memory" is a namespace
question, not a ranking question, and it exists the moment more than one agent writes to
the same vault regardless of what the leak probe concludes.

## Decision

Every agent and every project gets its own **memory namespace inside the ONE vault**, and
retrieval gains one **generic `scope` filter** over the ONE index. The contract, frozen:

```text
every agent and project gets its own memory namespace inside the ONE vault (no
fragmentation — cite ADR-0074): PROJECTS/<name>.md for projects (existing convention),
NEW top-level AGENTS/ folder with one note per agent (AGENTS/<agent-name>.md) carrying
the same structures (frontmatter, typed relations, [category] observations). Retrieval
gains a generic scope filter: parameter name "scope" everywhere (CLI flag --scope, MCP
param scope, PG query param scope). Semantics: posix-style relative path prefix matched
at segment boundary — a path P matches scope S iff P == S or P == S + ".md" or
P.startswith(S + "/"). Case-sensitive. Reject (error, no results) scopes containing
"..", leading "/", a drive letter, or backslashes. Applied AFTER the existing section
filter. Examples: scope="PROJECTS/vkm-kit" -> that note only; scope="AGENTS" -> all
agent memories; scope="AGENTS/vkm-implementer" -> one agent's memory.
```

Three consequences of that wording are deliberate:

- **Segment boundary, not substring.** `scope="AGENTS/vkm"` matches neither
  `AGENTS/vkm-implementer.md` nor `AGENTS/vkm.other/x.md`'s siblings by accident — a path
  matches only as the note itself (`S` or `S + ".md"`) or under the directory (`S + "/"`).
- **Invalid scopes error rather than return empty.** A scope with `..`, a leading `/`, a
  drive letter or backslashes is a caller bug or a traversal attempt; zero results would
  disguise both as "no memory yet".
- **Applied after `section`.** `scope` composes with the ADR-0056 section machinery
  instead of replacing it; the two filters answer different questions (what kind of note
  vs. whose note).

The starter vault scaffolds the convention (`AGENTS/README.md` + `AGENTS/TEMPLATE.md` in
both languages, linked from the `START_HERE.md` hub), `examples/AGENTS/vkm-implementer.md`
shows a filled note, and `assemble_context` takes `agentName` to include
`AGENTS/<agentName>.md` in the budgeted bundle exactly as `project` includes the
`PROJECTS/` note.

## Alternatives considered

- **A vault per agent.** Rejected — fragmentation: N indexes to build and keep fresh, N
  sync repos, no cross-vault `[[wikilinks]]`, and the isolation it buys is delivered by
  `scope` over one index ([ADR-0074](./0074-cross-project-leakage.md) priced exactly this
  trade when it kept the vault singular).
- **A dedicated `agent:` parameter (and keep `project:` separate).** Rejected — two
  parameters that are both path prefixes in disguise, each costing schema characters every
  wired session ([ADR-0063](./0063-fixed-context-budget-inventory.md) /
  [ADR-0035](./0035-fixed-cost-diet-schema-budget.md)). One generic `scope` covers
  `PROJECTS/`, `AGENTS/` and any future namespace at the cost of one.
- **Frontmatter-derived scoping (`type: agent` + an `agent:` key).** Rejected — it
  requires reading and trusting note bodies to answer an addressing question the path
  already answers, and it cannot express "everything under `AGENTS/`" without a second
  mechanism.
- **Substring or glob matching.** Rejected — `AGENTS/vkm` silently matching
  `AGENTS/vkm-implementer.md` is the classic prefix bug; segment-boundary matching is the
  smallest semantics with no surprising positives, and globs are strictly more machinery.
- **Case-insensitive matching (friendlier on Windows).** Rejected — vault paths are
  produced by the kit's own tools with stable casing, the index stores them verbatim, and
  a case-insensitive filter would behave differently across platforms for the same vault.

## Consequences

- Positive: per-agent memory exists with zero new infrastructure — no new vault, no new
  index, no new daemon. An agent's verdicts and lessons live at a predictable path and are
  recalled with one parameter.
- Positive: the filter is uniform across the three surfaces (CLI `--scope`, MCP `scope`,
  PG query param `scope`), so what an agent learns interactively transfers verbatim to
  scripts and to the projection's HTTP API.
- Positive: the convention is scaffolded, not just documented — a fresh vault ships
  `AGENTS/` with a README and a template, and the examples tree shows a filled note.
- Negative: one more optional parameter on the retrieval tools — schema characters every
  wired agent pays every session (ADR-0063). Accepted for capability, same reasoning as
  the ADR-0035 raise in [ADR-0084](./0084-postgres-projection-layer.md).
- Negative: case-sensitivity is a foot-gun on case-insensitive filesystems: `agents/` in a
  query matches nothing even though the OS would open the folder. Documented; the contract
  stays case-sensitive because the index is.
- Neutral: ADR-0074 is untouched. The leak question stays with the nightly probe; `scope`
  is addressing, not a ranking fix, and no default changed — an unscoped search behaves
  exactly as before.

## References

- [ADR-0074](./0074-cross-project-leakage.md) — the fragmentation trade and the leak
  question this ADR deliberately does not claim to settle.
- [ADR-0056](./0056-research-knowledge-bank.md) — the `section` machinery `scope`
  composes with.
- [ADR-0063](./0063-fixed-context-budget-inventory.md) /
  [ADR-0035](./0035-fixed-cost-diet-schema-budget.md) — schema characters are paid every
  session; why one generic parameter beats two dedicated ones.
- [ADR-0084](./0084-postgres-projection-layer.md) — the projection whose query surface
  gains the same `scope` param.
- Guides: [`docs/es/memoria-postgres.md`](../es/memoria-postgres.md) ·
  [`docs/en/postgres-memory.md`](../en/postgres-memory.md).
- Templates: `packages/create-vkm-kit/templates/vault/{es,en}/AGENTS/` ·
  `examples/AGENTS/vkm-implementer.md`.

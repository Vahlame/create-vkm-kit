# ADR-0023: Structured knowledge graph — typed relations + observations

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** maintainer

## Context

The vault is already a graph, and the kit already uses it. ADR-0019 traverses the
`[[wikilink]]` graph as a retrieval signal; ADR-0021 tunes its fusion weight. But
that graph is **untyped and write-only from the agent's side**: every edge is the
same "A links to B", and the only thing the system can _do_ with it is nudge a
ranking. You cannot ask the graph a question — "what supersedes ADR-0019?", "show
every `[gotcha]` about SQLite", "what links to `python`?" None of those are
expressible, because the structure that would answer them is not modeled.

Competing local-first memory systems (Basic Memory, MemPalace) model exactly that
structure: **typed relations** (`implements`, `supersedes`, `part_of` — not just
"links") and **categorized observations** (`- [decision] … #tag`), extracted from
notes and queryable. This is the single biggest capability gap between this kit and
those tools — and, critically, their structure is expressed as **plain-Markdown
conventions**, which means closing the gap does not require abandoning any of this
kit's invariants (Markdown is the source of truth; the SQLite index is a derived,
git-ignored cache; the Python core is dependency-free; every retrieval-ranking
change is measured).

A telling data point: scanning the maintainer's real 55-note vault with the new
parser surfaced **205 observations** (`[fact]`, `[hypothesis]`, `[decisión]`) and
**145 relations** that already existed in the notes — latent structure from the
basic-memory era that the kit could neither see nor query. The structure is already
there; we were just throwing it away.

## Decision

Add a **structured knowledge-graph layer** parsed from Markdown conventions and
persisted into the existing `fts.sqlite`, exposed as queryable surfaces. It is
purely **additive**: the lexical + semantic + graph _ranking_ path of ADR-0017/
0019/0021 is untouched (byte-identical; the retrieval bench is unchanged).

- **Conventions (Basic-Memory-compatible).** A relation is a list item
  `- <verb> [[target]] (optional context)`; any other `[[wikilink]]` is an untyped
  `relates_to` edge. An observation is a list item `- [category] content #tags`.
  Relation verbs are a single anchored token, so a prose bullet
  (`- Lección cross-proyecto en [[x]]`) never mints a garbage type; GFM task
  checkboxes (`- [ ]`, `- [x]`) are never mistaken for observations.
  ([`knowledge_graph.py`](../../packages/obsidian-memory-rag/src/obsidian_memory_rag/knowledge_graph.py))

- **Persisted, derived, always-consistent.** Two tables (`relations`,
  `observations`) are populated in the **same per-note pass** of `index_vault` from
  the body already in hand — no extra file read. Relation `target`s are stored as
  raw normalized keys and resolved to paths **at query time**, so a table row is a
  pure function of its own note's text (a sibling note appearing later never leaves
  a stale resolution). A `schema_meta` version forces one full reindex on upgrade.

- **Queryable surfaces.** Three CLI/MCP tools:
  `vault_relations(note, direction)` (an entity's typed edges, both directions),
  `vault_observations(category, tag, note)` (structured facts), and
  `vault_kg_suggest(note)` — a **read-only** assistant that proposes typing/
  observation candidates from a note's prose but **never writes** (same contract as
  `memory_extract_candidates`: the agent confirms, then edits the note).

- **This unblocks ADR-0019's deferred edge table.** ADR-0019 deferred a persisted
  adjacency table specifically because the incremental indexer skips unchanged
  notes, so a newly added table would never backfill them. The `schema_meta`
  version solves exactly that (a version bump forces the one full reindex). The
  persisted `relations` table is that adjacency list, now realized; switching
  `graph_neighbors` to read it (instead of re-scanning every body per query) is the
  obvious next optimization, deferred here only so it can be landed behind the
  retrieval bench.

## Alternatives considered

- **Separate graph DB / triple store (RDF, SQLite-as-graph schema):** rejected. It
  would make a derived store authoritative and break "Markdown is the source of
  truth" — the whole point is that the structure lives in the notes and survives
  in git without the index.
- **Auto-write structure into notes (extract relations/observations and edit the
  files):** rejected for now. The vault is the user's; silently rewriting prose
  into typed lines is exactly the kind of unrequested mutation the kit avoids.
  `vault_kg_suggest` proposes; the human approves; the agent edits. Auto-extraction
  with confirmation could revisit this later.
- **Type-weighted graph retrieval shipped on (boost `supersedes`/`implements`
  edges over `relates_to`):** deferred, not rejected. It is plausible that typed
  edges should fuse at different weights, but ADR-0021 showed the graph signal is
  delicate (it had to drop to weight 0.1). Changing ranking without the bench
  earning it would violate ADR-0020. The typed edges are now available to that
  experiment; it ships off until measured.
- **Store the resolved `target_path` in the table:** rejected. It introduces a
  cross-note write-time dependency (note A's row depends on note B existing), which
  reintroduces exactly the staleness the query-time resolver avoids.

## Consequences

- **Positive:** the kit gains queryable typed relations and categorized
  observations — real parity with Basic Memory / MemPalace — over structure that
  already exists in vaults (205 + 145 in the reference vault, previously invisible).
  Markdown stays authoritative; the conventions are byte-compatible with Basic
  Memory, so vaults interoperate. The default retrieval path is byte-for-byte
  unchanged and the bench is unaffected. Parsing cost is a few regexes on a body the
  indexer already read; graph _queries_ become an indexed table read instead of a
  full-body rescan.
- **Negative:** the derived schema gains two tables and a version, so the first
  index after upgrade does one full rebuild (one-time, automatic). Relation `in`
  (back-link) queries currently scan the `relations` table and resolve targets in
  Python — fine at personal-vault scale, a back-link index is the scale-up.
- **Neutral:** notes that use no conventions are unaffected (every `[[wikilink]]`
  is still a `relates_to` edge, exactly as before). Categories are taken verbatim
  (lowercased), so `decision` and `decisión` are distinct — intentional; the user
  owns their taxonomy.

## References

- ADR-0017 (hybrid query), ADR-0019 (graph-aware retrieval — this realizes its
  deferred edge table), ADR-0020 (measured retrieval quality), ADR-0021 (ranking
  weights this leaves untouched)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/{knowledge_graph,kg_query,indexer,store}.py`
- `packages/obsidian-memory-mcp/src/hybrid-mcp.mjs` — `vault_relations` / `vault_observations` / `vault_kg_suggest`
- `ARCHITECTURE.md` — retrieval engine + knowledge-graph surfaces

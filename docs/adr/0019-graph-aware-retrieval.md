# ADR-0019: Graph-aware retrieval over the `[[wikilink]]` graph

- **Status:** Accepted
- **Date:** 2026-06-15
- **Deciders:** maintainer

## Context

A vault is not a flat bag of notes — it is a **knowledge graph**. The kit's own
conventions wire it that way: "one idea per file, link with `[[wikilinks]]`", so
`PROJECTS ↔ STACKS ↔ PRACTICES ↔ RULES` form a dense web of edges. The code
already _parses_ that graph: `audit.py` extracts every `[[wikilink]]` to flag
broken ones (ADR-0018 / D4).

But retrieval throws the structure away. `hybrid_search` (ADR-0017) fuses BM25
(lexical) with vector cosine (semantic) and nothing else — it is **link-blind**.
So a query like _"how do I handle SQLite errors in the inventory app"_ can rank
`PROJECTS/app-ap-sport-inv.md` highly yet miss `STACKS/sqlite.md`, even though
the project note links straight to it with `[[STACKS/sqlite]]`. The single most
relevant companion note is one hop away in a graph we already have in hand, and
we don't use it.

This is the classic data-structure lesson applied in place: model the relation
as a **graph**, represent it as an **adjacency list**, and traverse it. The
gap is real and the fix is bounded.

## Decision

Add an **optional third ranking** to `hybrid_search`: notes one hop from the
strongest hits in the `[[wikilink]]` graph, fused via the **existing** Reciprocal
Rank Fusion (which already accepts N rankings).

- **`graphlink.py`** parses the graph on demand from the `vault_fts` bodies the
  indexer already keeps fresh — there is **no separate edge table** to maintain
  or backfill, so the graph can never go stale relative to the notes. Targets are
  resolved to real note paths Obsidian-style (full relpath, else unique basename).
- **Expansion** seeds from the top hits of the BM25 and vector lists, then scores
  each adjacent note by how many seeds touch it, **counting both directions**
  (a seed's out-links and any note that links _to_ a seed). A weakly-matching but
  strongly-linked note is **not** disqualified for being a faint hit itself —
  promoting it into the visible top-K is the whole point.
- **Fusion** stays RRF (`k = 60`). The `1/(k+rank)` damping makes the link signal
  a _soft_ boost: a strongly-linked note can surface, but the graph cannot outvote
  agreement between BM25 and cosine, nor dilute precision.
- **Opt-in** via `graph=True` (`--graph` on `hybrid-search` / `json-hybrid-search`,
  `graph: true` on the `vault_hybrid_search` MCP tool). Each hit gains a
  `graph_rank`. Default stays **off** until an adherence eval measures the
  precision/recall trade — see _Consequences_.

A second, smaller structure from the same lesson also lands: **`complete`**, a
prefix-autocomplete CLI/MCP surface backed by a **Trie** (`trie.py`) over note
titles, filename stems and inline `#tags` — `O(len(prefix))` to the branch plus
`O(matches)`, the textbook fit for "resolve a partial name to what exists".

## Alternatives considered

- **Persisted `note_links` adjacency table, written by the indexer:** _deferred,
  not rejected_. Cheaper per query at scale, but on the upgrade boundary the
  incremental indexer skips unchanged notes, so their edges would never be
  inserted — the graph would stay empty until each note happened to be edited.
  Parsing from the always-current FTS body sidesteps the staleness entirely and
  is O(N) per query, the same order as the brute-force cosine already accepted in
  ADR-0017. The table is the obvious scale-up behind the same `neighbor_paths`
  interface, paired with sqlite-vec when that lands.
- **Graph signal on by default:** rejected _for now_. Fusing a third ranking
  changes results for every user; without an eval it could regress precision on
  sparsely-linked vaults. Ship opt-in, measure, then consider flipping the default.
- **Personalized PageRank / multi-hop centrality:** rejected as over-engineering
  at personal-vault scale. One hop with reference-count scoring captures the
  "linked to a strong hit" intent; multi-hop risks topic drift for little gain.
- **Embed link context into the chunk text:** rejected — entangles the semantic
  index with link structure, forces a re-embed on any link edit, and still can't
  express back-links cleanly.

## Consequences

- **Positive:** recall improves exactly where this kit's densely-linked vault was
  losing it — a companion note (`STACKS/<tech>`, a linked `RULES/` or `PRACTICES/`
  entry) surfaces with the project that references it. Reuses RRF unchanged; the
  default lexical+semantic path is byte-for-byte the same when `graph=False`. Fully
  unit-tested with the hashing embedder (a note matching _zero_ query terms is
  pulled in purely by a wikilink).
- **Negative:** with `graph=True` each query parses every note body for links
  (O(total bytes), a cheap regex but real); on a sparsely-linked vault the third
  ranking adds little. Mitigated by keeping it opt-in and by the RRF damping.
- **Neutral:** ambiguous bare-basename links resolve deterministically
  (lexicographically first); since the graph is only a soft boost, a rare wrong
  pick cannot break a result. `complete` covers inline `#tags` only — frontmatter
  `tags:` are not in the FTS body and are out of scope.

## References

- ADR-0017 (hybrid query this extends), ADR-0014 (hybrid retrieval), ADR-0018 (the
  audit path that first parsed the link graph)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/{graphlink,trie,complete,query,vector_store}.py`
- `ARCHITECTURE.md` — Retrieval data flow

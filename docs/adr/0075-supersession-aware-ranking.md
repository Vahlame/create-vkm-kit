# ADR-0075: Turning on the graph ranked the superseded decision first

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** maintainer

## Context

The vault doctrine treats supersession as a first-class memory operation: decisions get
replaced, and `- supersedes [[old]]` is the typed relation that records it. ADR-0027
added verb weighting so a `supersedes` neighbour outranks a bare link, and
`test_typed_neighbor_weights_strong_verb_above_weak` has been green ever since.

That test checks the **graph layer's ordering**. Nothing checked the question memory
actually asks: _when a decision has been superseded, does a query about the topic return
the current decision or the obsolete one?_

Measured on five independent supersession pairs — old note, new note carrying the
`supersedes` edge, ten filler notes, one topic query each:

| configuration          | current first | **obsolete first** |
| ---------------------- | ------------- | ------------------ |
| `graph` off (baseline) | 2/5           | **3/5**            |
| `graph: true`          | 0/5           | **5/5**            |
| `graphTyped: true`     | 0/5           | **5/5**            |

Turning on graph fusion made the wrong answer **deterministic**.

The mechanism is not subtle once seen. The edge is authored in the **new** note. The new
note matches the query and becomes a graph seed; the **old** note is its one-hop
neighbour and collects the neighbour boost — while the new note gets nothing from its own
out-edge. The vault having recorded that a decision was replaced is precisely what
promotes the replaced decision.

The baseline row matters too: 3/5 wrong with the graph off. Ranking has no notion of
currency at all. The graph lever did not invent the problem; it removed the coin flip and
made it always lose.

## Decision

`superseded_map()` collects `supersedes` edges whose **both** ends are already in the
fused result; `demote_superseded()` reorders so each superseding note precedes the note
it supersedes. Applied in `hybrid_search` **before** the cut to `limit` — after the cut,
the current decision can be the one that falls off the end.

Three properties make this safe enough to be always-on rather than another opt-in knob:

- **Membership-preserving.** Nothing is added or removed, only ordered. ADR-0027's
  navigation case ("what did this note supersede?") still gets the old note back, one
  position lower.
- **No-op without the data.** It touches nothing unless the vault authors `supersedes`
  relations. Verified rather than asserted: the token bench wire total is **11,810 both
  before and after** — byte-identical — and `recall@5` stays 1.000.
- **Terminating.** A mutual pair (A supersedes B, B supersedes A) is data a vault should
  not contain; it resolves to "leave that pair alone" instead of looping, because a
  ranking function must always return.

After the fix, across all three configurations: **obsolete-first 0/5**, current-first 5/5
with the graph off and 4/5 with it on. The remaining case is not a supersession failure —
the pair is correctly ordered and a filler note outranked both.

An opt-in flag was rejected. This is not a preference, it is the difference between
answering with the current decision and answering with the one the vault was explicitly
told is obsolete; a knob would mean shipping the wrong answer by default.

## Alternatives considered

- **Change the verb weight in `TYPED_RELATION_WEIGHTS`.** Rejected, and worth stating
  because it is the obvious move and it is wrong. Weights are rank-based inputs to RRF —
  lowering `supersedes` weakens the navigation case ADR-0027 built without guaranteeing
  the ordering memory needs, and the defect reproduces at 3/5 with the graph **off**,
  where those weights are not consulted at all.
- **Exclude superseded notes from results.** Rejected: it breaks navigation, and it makes
  a note unreachable through search because of one line another note wrote about it.
- **Demote by frontmatter date instead of the relation.** Rejected: mtime and `date:`
  answer "recently edited", not "still true". `recency: true` already exists for the
  first question and is deliberately separate.
- **Fix it in `typed_neighbor_paths` (do not emit superseded targets as neighbours).**
  Rejected: it only covers `graphTyped`, leaving `graph: true` (5/5 wrong) and the
  baseline (3/5 wrong) broken, and it degrades neighbour expansion for every caller to
  fix a ranking concern.

## Consequences

- Positive: the obsolete-first rate goes 5/5 → 0/5 with the graph on, and 3/5 → 0/5 with
  it off. Pinned by a test **verified to fail** when the reorder is disabled.
- Positive: `supersedes` becomes a relation with a measurable payoff, which is a
  precondition for anything ever authoring it. Today it is nearly inert — 2 occurrences
  repo-wide — so the blast radius of this change on existing vaults is zero by
  construction.
- Neutral: one extra index read per search, only when the fused set is non-empty, and one
  `SELECT` filtered to `relation_type = 'supersedes'`. Both bench gates unchanged.
- Negative: it fires only on the **typed** relation. A note superseded in prose, or by a
  bare `[[wikilink]]`, is invisible to it — and the doctrine does not yet tell the model
  to author the edge.

## References

- `packages/obsidian-memory-rag/src/obsidian_memory_rag/graphlink.py`
  (`superseded_map`, `demote_superseded`)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/query.py` (`hybrid_search`)
- `packages/obsidian-memory-rag/tests/test_retrieval_levers.py` (3 cases)
- ADR-0027 (verb weighting, and the navigation case preserved here), ADR-0019 (graph
  fusion), ADR-0038 (the evolutive-memory loop supersession belongs to)

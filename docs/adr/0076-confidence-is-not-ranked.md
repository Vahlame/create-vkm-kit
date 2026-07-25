# ADR-0076: Ranking ignores `status`, and the obvious fixes are both already refuted

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** maintainer

## Context

The shipped doctrine asks the model to separate facts from hypotheses and to mark them:
_"Marca las hipótesis como tales (frontmatter `status: hypothesis|confirmed` +
`last_verified`); promuévelas a hechos solo al confirmarse."_ The memory-lifecycle list
carried "confidence / decay" as the matching capability.

Whether retrieval honours any of that was never measured. The falsifiable prediction,
written before the measurement: if ranking ignores `status`, a hypothesis will outrank a
confirmed fact roughly half the time.

Five topics, each with a `status: hypothesis` note and a `status: confirmed` note, ten
filler notes, one query per topic:

| wording of the hypothesis note             | confirmed first | **hypothesis first** |
| ------------------------------------------ | --------------- | -------------------- |
| natural (hedged: "creemos que", "quizás")  | 4/5             | **0/5**              |
| adversarial (matches the query vocabulary) | 0/5             | **5/5**              |

**The prediction was wrong, and the truth is sharper.** It is not a coin flip: ranking is
purely relevance-driven and `status` is not consulted at all. Hedged prose loses on its
own, which is why the first run looked reassuring — that run was measuring my own writing
style, not the ranker. Rephrase the hypothesis so it matches the query better and it wins
every single time, while declaring itself unconfirmed.

## Decision

**Nothing ships.** Both obvious fixes are blocked, and each is blocked by a result the
repo already has.

**A tie-break — "prefer the confirmed note when both are in the result" — has nothing to
tie-break on.** ADR-0075 could order supersession pairs because `- supersedes [[old]]` is
an _explicit edge between two specific notes_. A hypothesis and the fact that settles it
carry no relation; pairing them means deciding two notes are about the same thing, which
is the semantic-duplicate problem the earlier audit killed by measurement — paraphrase
similarity 0.12–0.22 against false-positive similarity 0.12–0.33, distributions fully
overlapping. Building the tie-break means rebuilding the thing that failed.

**Surfacing `status` on the hit — the `why` pattern from ADR-0072, which is the right
shape — needs an index migration.** Frontmatter is not indexed at all: `vault_fts` holds
`path`, `mtime_ns`, `title`, `body` and nothing else. `status` would need a column, a
schema version bump and a full reindex of every installed vault. That is a change to the
on-disk format and deserves its own work package with its own evidence, not a paragraph
inside this one.

**A global demotion of `status: hypothesis` is worse than the defect.** A hypothesis with
no competing fact is often the only note on its topic; ranking it below filler notes turns
"unconfirmed" into "unfindable", and the doctrine explicitly wants hypotheses recorded and
retrievable.

## Alternatives considered

- **Boost `last_verified` recency instead of `status`.** Rejected: it answers "checked
  recently", not "true" — and `recency: true` already exists for the time question and is
  deliberately separate (ADR-0021).
- **Ask the model to write `supersedes` from the fact to the hypothesis it settles.**
  Genuinely promising, because it would reuse ADR-0075's machinery exactly. Rejected here
  only because it means adding to the fixed rules block, which is paid on every session
  (ADR-0063) — and ADR-0075 already notes that the doctrine does not yet ask for the
  `supersedes` edge either. Both belong in one measured pass over what the doctrine asks
  the model to author, not in a reflex.
- **Ship the measurement without an ADR.** Rejected: the next reader of the natural-wording
  run would see 4/5 confirmed-first and conclude confidence is handled.

## Consequences

- Positive: "confidence / decay" is closed with a number instead of staying an open item
  that looks cheap. The precise blocker is named, so the next attempt starts from the
  index migration rather than from the idea.
- Positive: the adversarial run is the finding. A benchmark whose fixtures are written by
  the person who wants a clean result will produce one — the first run here did exactly
  that, and only rephrasing five notes reversed 4/5 into 5/5.
- Negative: an agent can still be handed an unconfirmed note as its top hit with nothing
  in the response marking it unconfirmed. That is a real, unmitigated gap, written down
  rather than fixed.
- Neutral: no code, no tool, no parameter, no schema characters.

## References

- ADR-0075 (why supersession _could_ be ordered: an explicit edge between two notes)
- ADR-0072 (the `why` label — the right shape for this, blocked by the index schema)
- ADR-0063 (the fixed-layer budget that governs adding doctrine)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/store.py` (the `vault_fts`
  columns, which is the whole blocker)

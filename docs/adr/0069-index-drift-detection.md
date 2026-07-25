# ADR-0069: Detect index drift, and answer the architectural questions in the repo

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** maintainer

## Context

A review raised "multiple representations of knowledge — Markdown, graph,
embeddings, indices, SQLite — there should be one canonical model everything else
derives from" as the kit's top technical debt.

Read against the code, that debt does not exist as stated. Markdown **is** canonical,
and it is enforced structurally rather than by convention: `indexer.py` keys each note
on `(mtime_ns, size_bytes)`, drops rows whose file left disk, and rebuilds that note's
typed relations and observations from the text in the same pass. A `SCHEMA_VERSION`
bump clears the bookkeeping so every note is reprocessed — _"no note can stay stale"_
(`indexer.py:141`). Nothing writes to the graph, the FTS table or the vectors
independently of a note.

The real debt is narrower and sharper: **nothing verifies that the derived state still
matches the Markdown.** The incremental key cannot see an edit that preserves both
mtime and size — a `git checkout` that restores an mtime, a two-character swap inside
one filesystem timestamp tick, a restored backup. And a note deleted outside an
indexing pass leaves its row behind.

In a memory system that failure is worse than a missing index. A missing index fails
loudly; a stale one keeps answering, confidently, from text that is no longer on disk.

## Decision

**1. `vault_audit` reports `index_drift`.** Three classes, computed read-only against
the SQLite sidecar:

- `missing` — on disk, no index row (never indexed, or indexed then lost).
- `orphaned` — index row, no file (its text can still surface in results).
- `stale` — both exist, `(mtime_ns, size_bytes)` disagree.

`None` when no index exists, so an unindexed vault reports absence rather than a false
alarm. A locked or corrupt database also yields `None` — a broken sidecar is not a
vault-health finding, and the rest of the audit must still return.

The report names its own fix (`"fix": "vault_fts_index"`) and **never applies it**. A
report that repairs is a report that hides the problem it was added to surface; a test
pins that two consecutive audits see the same drift.

**Stated honestly: this closes the observable half of the gap, not all of it.** The
`stale` class is exactly the subset `(mtime_ns, size_bytes)` can see. Content hashing
would catch the rest and was rejected below.

**2. The architectural questions are answered in `ARCHITECTURE.md`,** not in a chat
reply: what the kit is (a memory substrate over MCP), which representation governs
(Markdown, structurally), how much intelligence belongs in the engine versus the model
(the measured answer: 45,247 chars of fixed prior, being moved to mechanism), whether
it works without skills (yes — `--rules-profile minimal`, 1,487 chars), how far it
scales (**unproven past a few thousand notes; the retrieval bench is 19 notes**),
whether it self-repairs (it detects and refuses to act, deliberately), and what the
global quality metric is (**there isn't one — a real gap**).

Several of those answers are admissions. That is the point: an architecture document
that only records strengths is marketing.

## Alternatives considered

- **Hash every note's content on every audit.** Catches the mtime+size blind spot
  exactly. Rejected for now: it is O(bytes) per audit on a tool users are told to run
  routinely, to catch a case that requires an mtime-preserving edit. The honest
  trade is recorded rather than hidden — if drift shows up in practice, an opt-in
  `deep: true` is the follow-up, and it belongs behind a flag because its cost is real.
- **Auto-reindex when drift is found.** Rejected on the same principle `vault_audit`
  already states for hygiene: detect, propose, let the human act. Silent repair also
  destroys the evidence of _why_ it drifted.
- **A new `vault_verify_index` tool.** Rejected on budget. The vault schema gate had
  **52 characters** of headroom (ADR-0063); a new tool cannot fit. A field on an
  existing result costs **zero** schema characters, which is why the mechanism took
  that shape. The one-line description edit still overran the gate by 2 chars on the
  first attempt and was trimmed to fit — the gate was not relaxed (invariant: never
  relax a gate to make a change pass). Final: 10,790 / 10,800.
- **Put the architectural answers in a new doc.** Rejected — `ARCHITECTURE.md` is
  where a reader already looks, and a second document is a second thing to drift.

## Consequences

- Positive: the one property the whole design rests on — derived state matching the
  Markdown — is now checkable instead of assumed.
- Positive: the kit's identity, governance and scale limits are written down where
  contributors and reviewers will find them, including the parts that are unproven.
- Negative: `stale` detection inherits the incremental key's blind spot. Named in the
  code, the ADR and the tests rather than left for someone to discover.
- Neutral: no new tool, no new parameter, +42 chars of schema (10,790 / 10,800).
- Neutral: the audit now opens the sidecar read-only on every call. Measured as
  negligible next to the existing filesystem walk, which already reads every note.

## References

- `packages/obsidian-memory-rag/src/obsidian_memory_rag/audit.py` (`index_drift`)
- `packages/obsidian-memory-rag/tests/test_audit.py` (4 cases, incl. the read-only pin)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/indexer.py:125-210` (the
  derivation this checks)
- `ARCHITECTURE.md` § _Architectural questions, answered_
- ADR-0063 (the schema budget this had to fit inside), ADR-0037 (vault as memory
  layer, not system of record)

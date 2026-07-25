# ADR-0072: Tell the agent why a hit surfaced, not what it scored

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** maintainer

## Context

Two designs for the search envelope came out of the memory-lifecycle review: a
**truncation signal** (tell the agent the result set was cut) and a **provenance label**
replacing the rounded fused score. Both were measured before either was built. Only one
survived, and the measurement that killed the other is the more useful finding.

### The fused score says nothing the order does not

Every default `vault_hybrid_search` hit carried `score: round(h.score, 5)`. RRF scores
are **rank-derived** — `1/(k + rank)` summed across rankers — so their magnitude has no
external meaning: `0.03252` is not a probability, not a similarity, and not comparable
across queries. The only thing it expresses is position in an ordering.

Measured on the 38-query retrieval corpus at `limit: 10` — **380 hits, 0 cases where the
score rose as rank fell.** The field is monotone with hit position by construction, so
in the default payload it is strictly redundant with the array index the agent already
has.

### Which rankers matched is not recoverable from order, and is actionable

A hit that surfaced on embedding similarity alone is weak evidence for a query naming an
exact identifier — a filename, a flag, an error string. The agent's correct response is
to retry through `vault_fts_search`, which is exactly the routing the doctrine already
describes and the agent previously had no way to trigger, because nothing in the
response distinguished the two cases.

Measured distribution of the label over both eval corpora:

| corpus                           | limit | `lex+sem` | `sem` |
| -------------------------------- | ----- | --------- | ----- |
| retrieval (19 notes, 38 queries) | 5     | 92        | 98    |
| retrieval                        | 10    | 157       | 223   |
| tokens (7 notes, 16 queries)     | 5     | 26        | 54    |

Bimodal and balanced — not a near-constant field dressed up as information.

### The truncation signal did not survive the same test

The proposal: flag when the result set was cut, so the agent can tell "10 notes matched"
from "50 matched, you got 10". The falsifiable prediction written before building it was
that the flag must fire **selectively**; a flag that fires on every response is pure
token cost.

It fires on **100% of queries, in both corpora, at every limit tested.** And this is not
a corpus artifact — it is arithmetic. The semantic pass is dense: cosine similarity
assigns a score to every chunk, so `semantic_search(limit=candidate_pool * 3)` returns
candidates from every note in the vault. The fused pool is therefore _always_ the whole
vault, and "pool > limit" is _always_ true in any vault larger than `limit`.

An honest note on how this was found: the first probe reported pool sizes with a median
of **1**, which would have made the flag look beautifully selective. That number was
wrong — the probe called `index_vault` without `index_vectors`, so it measured a
BM25-only pool and the entire semantic half of the system was missing. The flag's case
was built, briefly, on a vault with no vectors in it.

A lexical-only variant (flag when _more notes contain the literal terms_ than were
returned) does fire selectively here — 34.2% and 12.5%. It is not shipped either: both
corpora are 19 and 7 notes, i.e. **smaller than or comparable to `limit` itself**, so
their firing rate says nothing about a real vault. Shipping on that evidence would be
picking a number, which is the mistake ADR-0063 exists to avoid.

## Decision

`why` replaces `score` in the default `json-hybrid-search` payload: the rankers that put
this hit in the result, lexical-first — `lex+sem`, `lex`, `sem`, `graph`.

`score` is not deleted; it moves behind `--explain` next to `score_raw` and the
per-ranker ranks, where the diagnostics already live. Under `rerank: true` the hit order
comes from the cross-encoder logit while `score` stays the RRF value, so there the two
genuinely differ — and `explain` is where a caller investigating that disagreement is
already looking.

`_why()` lives in `query.py` beside `HybridHit`, not in `cli.py`, because
`bench_tokens.py`'s wire arm must emit the identical shape and importing the CLI into a
bench module invites a cycle. That arm is updated in lockstep: a bench measuring a
payload the server no longer sends is a number about nothing.

**No truncation signal ships.** The refutation is recorded here so the design is not
re-proposed on the intuition that produced it.

## Alternatives considered

- **Keep `score` and add `why`.** Rejected: it pays for a field measured to be
  redundant. The point of ADR-0034's compact format is that the default payload carries
  only what the agent acts on.
- **Advertise `why` in the `vault_hybrid_search` tool description.** Rejected on the
  ADR-0063 budget: the schema gate has ~10 chars of headroom, the description is paid on
  **every session** whether or not a search runs, and the field is self-describing in
  every response that contains it (`"why":"lex+sem"`). Raising the gate to fit prose
  about a visible field is the exact trade that ADR-0063 forbids.
- **Report a candidate `total` instead of a boolean flag.** Rejected as a lie by
  construction: `candidate_pool` caps the BM25 side at 50, so any "total" is really
  "min(matches, 50)" wearing a more confident name.
- **Ship the lexical-only truncation variant.** Rejected on corpus size, above. It
  becomes decidable with a corpus substantially larger than `limit`, which the repo does
  not have.

## Consequences

- Positive: the default hit now carries a signal the agent can route on, and the one it
  could not use is gone.
- Positive: **−53 tokens (−0.45%)** on the token bench's wire total (11,863 → 11,810).
  Stated plainly because it is small: the `why` field is 14.6% cheaper than `score` per
  hit, but snippets dominate the payload, so this is an **information** change, not a
  token win. Wire savings median is unchanged at 37%, and the CI gate holds.
- Positive: a refuted design is recorded with the measurement that refuted it, including
  the broken probe that nearly made it look good.
- Negative: any consumer parsing `hit.score` from a default response breaks. In-repo
  there was exactly one (`bench_tokens.py`) plus one test contract, both updated. The
  field remains available under `explain: true`.
- Neutral: no new tool, no new parameter, no schema characters.

## References

- `packages/obsidian-memory-rag/src/obsidian_memory_rag/query.py` (`_why`)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/cli.py` (`json-hybrid-search`)
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/bench_tokens.py` (wire arm)
- `packages/obsidian-memory-mcp/test/python-json-search.test.mjs` (wire contract)
- ADR-0034 (the compact format this refines), ADR-0063 (the schema budget that rejected
  advertising the field), ADR-0026 (the reranker case where `score` is not redundant)

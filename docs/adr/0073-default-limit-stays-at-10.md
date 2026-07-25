# ADR-0073: The default search limit stays at 10, and the corpus that said otherwise could not fail

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** maintainer

## Context

ADR-0034 lowered `vault_hybrid_search`'s default `limit` from 20 to 10 on a wire
measurement. The obvious next step — lower it again to 5, or even 3 — has been sitting in
the backlog with an apparently strong case behind it. `evals/tokens/` reports:

| k   | answered | median savings (wire) |
| --- | -------- | --------------------- |
| 3   | 100%     | 62%                   |
| 5   | 100%     | 37%                   |
| 10  | 100%     | 20%                   |

Read plainly: three passages answer everything and save three times as much. The kit's
own README says as much, and the doctrine tells the model to pass `limit: 3–5`.

**That table cannot say no.** The tokens corpus is **7 notes** with ground truths of at
most **2**, and the retrieval corpus is 19 notes. Both are smaller than or comparable to
the limit under test, so every `k >= 2` satisfies the completeness gate by construction.
100% at k=3 is not a finding about `k`; it is a restatement of the corpus's shape.

Lowering a default that every session pays, on a benchmark that has no failing case, is
picking a number — the mistake ADR-0063 exists to avoid.

## Decision

**The default limit stays at 10**, and `evals/limit/` exists so the question is decidable:
74 real ADRs, 15 queries, ground truths of 3–6 notes.

Measured at commit `f034475`, deterministic hashing embedder:

| k      | answered | wire savings, median (answered only) |
| ------ | -------- | ------------------------------------ |
| 3      | 13%      | —                                    |
| 5      | 13%      | 3% (n=2)                             |
| **10** | **60%**  | **70%**                              |
| 20     | 87%      | 36%                                  |
| 40     | 93%      | —                                    |
| 74     | 100%     | —                                    |

`k=5` answers **13%** of multi-note queries where `k=10` answers **60%** — a 4.6× gap on
exactly the queries where the limit is the binding constraint.

`k=10` is also _cheaper in practice_, which is the counter-intuitive part and the reason
the old table misleads: a query that fails the completeness gate contributes no savings,
because the agent does not have the answer and reads the notes anyway. Cheap-and-wrong
is not a saving. The k=5 savings figure is over **2 answered queries** and is reported
here only so it is not mistaken for a real distribution.

Going the other way is not free either: `k=20` answers 87% but median savings fall to 36%
with a mean of −2% and a worst case of −566% — past 10, passages start costing more than
the notes they replace.

**This ADR does not claim 10 is optimal.** It claims 5 is worse than 10, which is the
question that was actually on the table. A defensible optimum needs a larger corpus and
more query shapes than 15.

## Alternatives considered

- **Lower to 5 on the existing evidence.** Rejected: the evidence is a benchmark with no
  failing case. That the number would have looked good is the problem, not the defence.
- **Extend `evals/tokens/` instead of adding a corpus.** Rejected: its measured floors
  are CI gates (`--assert-savings 0.40`, `--assert-answered 1.0`,
  `--assert-wire-savings 0.30`). Changing its corpus moves every recorded number and
  silently redefines what those gates protect. A question about defaults should not
  rewrite a regression gate.
- **Gate this bench in CI.** Rejected: the corpus is the repo's own `docs/adr/`, so it
  grows with every decision and the numbers move by design. It answers a question once
  and records the commit it answered it at; it does not defend a floor.
- **Write a synthetic 74-note vault instead of using the ADRs.** Rejected: fabricated
  notes let the author decide, consciously or not, how hard retrieval is. Real documents
  with real shared vocabulary can embarrass the ranker, and this one did.
- **Change the doctrine's `limit: 3–5` advice.** Deliberately **not** done here. That
  advice is for _targeted_ recall — one known fact, one note — which is a different query
  shape from the multi-note questions this set is built from, and the tokens corpus is
  fair evidence for it. Conflating the two is what produced this ADR.

## Consequences

- Positive: a default that every session pays is now defended by a benchmark that can
  fail, instead of one that cannot.
- Positive: the false lesson is corrected in the place it came from — `evals/README.md`
  now carries a callout, next to the 100%-at-k=3 table itself, saying why that row is a
  fact about a 7-note corpus and not a case for lowering the default.
- Negative: `evals/limit/` is not CI-gated, so nothing stops its numbers drifting. The
  k=74 = 100% row is the guard that keeps the rest interpretable: every label is
  reachable, so a low answered rate at low k is a limit effect and not a broken label.
- Neutral: no code changes. No tool, no parameter, no schema characters, no default moved.
  The deliverable is the evidence and the decision not to act.

### An honest note on how this was measured

The first version of this set asked its 15 questions **in Spanish against English ADRs**,
with the dependency-free hashing embedder — which has no cross-lingual capability at all.
It measured that, not the limit: k=10 answered **13%** and k=20 only **27%**, a curve
that reads as "the default is far too low, raise it to 40". Translating the same 15
queries, labels untouched, moved k=10 to **60%**.

The k=74 ceiling run is what exposed it. A 100% ceiling meant the labels were reachable
and the ranking was the problem, which pointed at the query/corpus language mismatch. Had
the ceiling not been run, the Spanish numbers would have supported a confident and
completely wrong conclusion — that the default should be _raised_ sharply.

## References

- `evals/limit/queries.jsonl`, `evals/limit/README.md`
- ADR-0034 (the 20→10 move this declines to extend), ADR-0032 (the token-economy bench
  whose corpus shape is the subject here), ADR-0063 (measure before gating)

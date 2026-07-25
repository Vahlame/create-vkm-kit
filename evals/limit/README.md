# Default-limit falsifier

A bench whose job is to be able to say **no** to lowering `vault_hybrid_search`'s
default `limit`.

## Why the existing corpora could not answer this

`evals/tokens/` reports **100% answered at k=3**, which reads as "the default could go
much lower". It cannot support that claim: its ground truths top out at **2 notes**, and
its corpus is **7 notes** — smaller than the default limit itself. Any `k >= 2` answers
everything, so the completeness gate can never fail on `k`. A benchmark that cannot fail
is not evidence.

The same holds for `evals/retrieval/` (19 notes).

## What this set changes

|                  | tokens corpus | this   |
| ---------------- | ------------- | ------ |
| notes            | 7             | **74** |
| max ground truth | 2             | **6**  |
| queries          | 16            | 15     |

Corpus is `docs/adr/` — 74 real, human-written ADRs with heavy shared vocabulary. Not a
synthetic vault: fabricated notes would let the ranker look better or worse than it is.

**Labelling rule (auditable):** a note is `relevant` when it _decides_ part of the
answer, not when it mentions the topic. Grep finds 8–14 ADRs per theme; each label keeps
the 3–7 a reader would actually have to open.

## Running it

```bash
python -m obsidian_memory_rag bench-tokens \
  --corpus docs/adr --queries evals/limit/queries.jsonl --k 10
```

## Result (commit f034475, hashing embedder)

| k      | answered | wire savings, median (answered only) |
| ------ | -------- | ------------------------------------ |
| 3      | 13%      | —                                    |
| 5      | 13%      | 3% (n=2)                             |
| **10** | **60%**  | **70%**                              |
| 20     | 87%      | 36%                                  |
| 40     | 93%      | —                                    |
| 74     | 100%     | —                                    |

`k=10` beats `k=5` on **both** axes — 4.6× the answered rate, and higher savings because
a query that fails the completeness gate contributes no savings at all. See
[ADR-0073](../../docs/adr/0073-default-limit-stays-at-10.md).

## Two limits of this set, stated plainly

- **Not a CI gate.** The corpus is the repo's own `docs/adr/`, so it grows with every
  decision and the numbers move. It answers a question once; it does not defend a floor.
  The k=74 = 100% row is what makes the rest interpretable: every label is reachable, so
  a low answered rate at low k is a **limit** effect, not an unreachable label.
- **Monolingual.** Queries are English because the corpus is. The first version of this
  set asked in Spanish against English ADRs and measured **cross-lingual failure of the
  hashing embedder** rather than the limit — k=10 answered 13%, and translating the same
  15 queries moved it to 60% with the labels untouched. Cross-lingual recall is what the
  Spanish `evals/retrieval/` corpus is for.

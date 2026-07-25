# ADR-0074: Cross-project isolation — measured, and the mitigation already shipped

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** maintainer

## Context

"Cross-project isolation" was on the memory-lifecycle list as a missing capability: a
recall about project A should not surface project B. The doctrine states the goal
plainly — _"PROJECTS/&lt;name&gt;.md — per-project context; do not mix projects"_ — and
nothing enforces it. The obvious shape of a fix is a `project:` filter reusing the
`section` machinery from ADR-0056.

Measured first, on the 19-note retrieval corpus, 12 queries whose ground truth is a
`PROJECTS/` note:

| k   | queries leaking another project | foreign hits |
| --- | ------------------------------- | ------------ |
| 3   | 4/12 (33%)                      | 4            |
| 5   | 11/12 (92%)                     | 15           |
| 10  | 11/12 (92%)                     | 30           |

The 92% is the number that would justify building the filter. **It should not be
trusted.** It is the same density artifact that refuted the truncation signal in
ADR-0072: the semantic pass scores every chunk, so every note is a candidate, and a
k=10 result on a 19-note vault is more than half the vault. "Another project appeared"
is close to arithmetically guaranteed. The number that costs an agent anything is the
top-3, where the doctrine tells it to read the section and stop: **4 hits.**

All four are the **same note**, `PROJECTS/bike-shop.md`, at rank 3, on queries about
three different projects. It is not a size outlier (683 bytes against 605–719 for its
siblings). It behaves like an attractor in the deterministic embedder's vector space.

## Decision

**No `project:` filter ships, and no code changes.** Two findings decide it.

**1. The mitigation already shipped, one ADR ago.** Three of the four top-3 foreign
hits carry `why: "sem"` — they matched on embedding similarity alone, with no lexical
overlap with the query. That is exactly the case ADR-0072's provenance label was built
to expose, and this is independent data: the label was designed on a different question
and validated here without being tuned for it. An agent asking about the Windows
optimizer and receiving a bike-shop note marked `sem` has, in the response itself, the
signal that the hit is weak.

**2. The decisive test cannot run in CI, so it runs nightly.** The measurement above
uses the deterministic `hashing-256` embedder — a dependency-free fallback with poor
semantic discrimination, kept precisely because it makes CI reproducible. A `--full`
install ships **fastembed**. Whether this leak survives a real embedder is the whole
question, and it cannot be asked in the blocking CI job (the model is a ~100 MB
download) nor in this development environment, whose egress policy denies
`huggingface.co`:

```json
"kind": "connect_rejected",
"detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
"host": "huggingface.co:443"
```

`evals/cross-project/probe.py` therefore takes `--embedder` and is wired into
`nightly-benchmarks.yml`, which already caches the fastembed model, running **both**
arms side by side. Running one embedder is an anecdote; running both is the experiment.

**A filter would have been built on an unfalsified premise.** Adding a `project:`
parameter costs schema characters on every session (ADR-0063), adds a knob the model
must decide when to use, and — if the leak is a fallback-embedder artifact — fixes
nothing for anyone running the recommended install.

## Alternatives considered

- **Ship the `project:` filter now and measure later.** Rejected: the top-3 evidence is
  4 hits from one note on one embedder. That is a lead, not a defect.
- **Gate the probe with a leak-rate ceiling.** Rejected: a floor here would freeze a
  number produced by one embedder on a 19-note corpus into policy — the ADR-0073
  mistake, one ADR after writing it down.
- **Derive isolation from the frontmatter/wikilink graph instead of a parameter.**
  Rejected as premature for the same reason, and it is strictly more machinery than the
  parameter it would replace.
- **Report only the top-3 number and drop the k=5/k=10 rows.** Rejected: the inflated
  rows are why this ADR exists. Hiding them means the next reader re-derives 92% and
  reaches the conclusion this ADR declines.

## Consequences

- Positive: a proposed capability is closed with measurement instead of code, and the
  reason it looked necessary is written down so it is not re-proposed.
- Positive: ADR-0072's `why` label gets independent validation — it flags 3 of the 4
  hits that matter, on a question it was not designed for.
- Positive: the blocked test becomes a scheduled one rather than an open question.
- Negative: the answer is not available today. The nightly run produces it, and until
  then "does cross-project leakage survive a neural embedder?" is honestly unknown.
- Neutral: no tool, no parameter, no schema characters, no default moved.

## References

- `evals/cross-project/probe.py`, `.github/workflows/nightly-benchmarks.yml`
- ADR-0072 (the `why` label validated here; the density argument reused)
- ADR-0073 (do not freeze a number from a corpus that cannot fail)
- ADR-0063 (schema characters are paid every session)

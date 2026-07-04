# ADR-0034: Compact search wire format + default limit 20→10, measured on the wire

- **Status:** Accepted
- **Date:** 2026-07-03
- **Deciders:** maintainer

## Context

The user's standing mission is to push the kit's token savings further — the
working target framed as "make Fable 5 cost like Sonnet 5" on the memory path
(Fable 5: $10/$50 per MTok vs Sonnet 5: $3/$15 — i.e. cut ~70% of the tokens
that flow through recall).

ADR-0032 measured the passage-first claim but counted only `heading + snippet`
content; the JSON overhead the agent actually reads was invisible. Inspecting a
real `vault_hybrid_search` response showed each hit ships ~20 tokens of pure
diagnostics the agent never acts on:

```text
"score":0.03252247488101534,"bm25_rank":2,"vector_rank":1,
"graph_rank":null,"rerank_score":null
```

Order already conveys rank to an LLM; `graph_rank`/`rerank_score` are null on
the default path; a 17-digit float and a 19-digit `mtime_ns` (FTS search) are
noise. On top of that, ADR-0032 had deferred the biggest lever — the MCP
default `limit` of 20 (~4× the k=5 cost) — pending usage data.

## Decision

Three changes, each measured:

1. **Compact wire format (default).** `json-hybrid-search` hits carry only
   `path`, `heading`, `snippet`, `score` rounded to 5 decimals (adjacent RRF
   ranks differ by ~2e-4 at k=60, so 5 decimals preserves ordering info);
   `json-search` hits carry `path`, `title`, `snippet`. All ranking
   diagnostics (`score_raw`, `bm25_rank`, `vector_rank`, `graph_rank`,
   `rerank_score`; `bm25`, `mtime_ns`) move behind a new `--explain` CLI flag
   / `explain` MCP param (default false) for debugging and benchmarks.
   Measured: **~20 tokens/hit** saved at equal k.
2. **MCP default `limit` 20→10** on `vault_hybrid_search` and
   `vault_fts_search` (resolves the ADR-0032 deferral). The tool descriptions
   now teach the ladder explicitly: 3–5 for targeted recall, raise only for
   broad surveys. Python API and CLI defaults stay at 20 (programmatic
   surface, no token pressure). Usage data on the real vault (8 representative
   recalls, read-only): default-call wire cost fell **−37.8%** overall; the
   one broad query that hit the old cap fell 1905→755 tokens (**−60%**);
   targeted queries returned <10 hits and lost nothing.
3. **The benchmark now measures the wire** (`bench_tokens.py`): a new wire arm
   serializes the exact compact JSON response (hits + `count` + `_trust`
   notice) so JSON overhead is charged to the passage side instead of hidden.
   New report fields (`wire_tokens`, `wire_savings`, `median_wire_savings`,
   `total_wire_tokens`) and a new CI gate `--assert-wire-savings 0.30` at k=5.

Measured on the 16-query fixture (100% answered at every k):

| k   | median savings (content, as ADR-0032) | median savings (wire, honest) |
| --- | ------------------------------------- | ----------------------------- |
| 3   | 69%                                   | 62%                           |
| 5   | 47%                                   | 37%                           |
| 10  | 33%                                   | 20%                           |

The wire column is the number the kit now claims: at the recommended targeted
recall (k=3) the agent pays **62% less** than whole-note reads — and that is a
floor (the control arm pays zero discovery cost, per caveman's methodology).
Stacked with the ADR-0032 output/code discipline rules, the ~70%
"Fable-priced-like-Sonnet" target is within reach **on the memory path**; no
claim is made about whole-session cost, which is dominated by the task itself.

## Alternatives considered

- **Dropping `score` entirely from the default hit:** rejected — 5 rounded
  decimals cost ~4 tokens/hit and preserve a relative-confidence signal agents
  do occasionally use; the measured waste was the null diagnostics, not the
  score.
- **Adaptive score-cliff truncation (autocut) instead of a lower default
  limit:** rejected for now — RRF scores are densely packed (k=60 squeezes the
  pool into a narrow band, see ADR-0021), so a cliff detector would be fragile;
  a lower default plus the 3–5 guidance is deterministic and testable.
- **Trimming the `_trust` notice / untrusted-data envelope:** rejected —
  security wording is exempt from compression (the kit's own token-discipline
  rules: never simplify security).
- **Changing the Python API/CLI defaults too:** rejected — only the MCP surface
  pays per-token; keeping library defaults avoids breaking programmatic
  consumers for zero token benefit.

## Consequences

- Positive: every default recall call is cheaper for **any** model wired to the
  MCP (the saving is in the tool result, not in model behaviour); the kit's
  token claim is now measured at the true wire cost; the ADR-0032 deferral is
  resolved with real-vault data; regressions fail CI (`--assert-wire-savings`,
  plus contract tests pinning the compact shape in `test_bench_tokens.py` and
  `python-json-search.test.mjs`).
- Negative: the wire format is a breaking change for any consumer that parsed
  the diagnostic fields — audited: none in-repo (the Node bridge passes hits
  through; `memory_extract_candidates` and the prompt compiler read only
  `path`/`snippet`). External consumers get them back with `explain: true`.
  A newer Node MCP paired with an older pip-installed `obsidian-memory-rag`
  errors only if `explain` is actually requested (same pairing story as every
  optional flag since `--rerank`).
- Neutral: `score_raw` under `--explain` preserves full float precision for
  debugging; benchmark totals now report both content and wire arms.

## References

- ADR-0018 (multi-agent token efficiency), ADR-0032 (token discipline +
  benchmark; its "default limit" deferral is resolved here), ADR-0021 (RRF
  score packing — why autocut was rejected).
- Measurements: `bench-tokens` fixture at k=3/5/10; real-vault read-only
  comparison (8 queries, old default limit 20 + diagnostics vs new default
  limit 10 + compact): −37.8% aggregate, −60% on the capped broad query;
  serialization-only delta ~20 tokens/hit.

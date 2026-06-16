# Evaluations

Two distinct things live here. Keep them separate:

1. **Retrieval quality (`retrieval/`)** — a **real, measured** benchmark of the
   hybrid search: recall@k, MRR, hit@1 over a fixed labelled corpus. Deterministic
   (dependency-free embedder), so it gates CI and regressions fail the build.
2. **Adherence harness (`adherence.yaml` + `run-adherence-ci.mjs`)** — a **smoke
   test of the eval pipeline**, not a model-behaviour measurement (see below).

## 1. Retrieval quality — measured, gated

`retrieval/corpus/` is a 16-note fixture vault (PROJECTS / STACKS / PRACTICES /
RULES / MEMORY) with deliberately overlapping vocabulary; `retrieval/queries.jsonl`
labels 18 queries (lexical, conceptual-Spanish, and OR-fallback) with their
ground-truth note paths. `obsidian_memory_rag.bench_recall` indexes the corpus
(FTS5 + vectors) and scores `hybrid_search` against the labels.

```bash
# human report
python -m obsidian_memory_rag bench-recall \
  --corpus evals/retrieval/corpus --queries evals/retrieval/queries.jsonl
# with the graph signal fused in
python -m obsidian_memory_rag bench-recall ... --graph
# CI gate (exits non-zero on regression)
python -m obsidian_memory_rag bench-recall ... \
  --assert-recall 0.95 --assert-mrr 0.90 --assert-hit1 0.90
```

**Measured floor** (default `HashingEmbedder`, dependency-free, reproducible):

| metric   | graph off | graph on |
| -------- | --------- | -------- |
| recall@5 | 1.000     | 1.000    |
| MRR      | 0.972     | 1.000    |
| hit@1    | 0.944     | 1.000    |

These are the **lexical floor**; a neural embedder (`pip install
'obsidian-memory-rag[semantic]'`, `--embedder fastembed`) only raises the
conceptual-query numbers. The CI job `retrieval-bench` and
`tests/test_bench_recall.py` both gate on the graph-off floor with a margin.
The `graph on` column is the empirical case for ADR-0019: link-fusion lifts the
hard OR-fallback queries from MRR 0.75 → 1.00 without hurting anything.

## 2. Adherence harness (smoke only)

> The CI job **`eval-harness-smoke`** is **not** a model-adherence evaluation — it verifies the eval harness itself runs end-to-end with a deterministic stub provider that echoes the expected token. The gate is always **1.0** unless the harness pipeline breaks (missing yaml, broken require, etc.). Do **not** treat a green badge here as evidence that any agent follows the vault User Rules.

To measure real adherence, run promptfoo locally with a live LLM provider against a real `basic-memory` MCP server.

## Files

- **`adherence.yaml`** — 20 deterministic test cases. Each test asks the provider to apply a `FACT_NN` token and asserts the response contains it.
- **`adherence-provider.cjs`** — **stub provider.** `callApi()` returns the expected token verbatim. Replace with a real provider (Anthropic/OpenAI SDK + MCP client) to do an actual adherence measurement.
- **`run-adherence-ci.mjs`** — CI harness that walks `adherence.yaml`, invokes the provider, and exits 1 if pass rate < 0.80. With the stub, pass rate is always 1.0 — that's the point of a smoke gate.

## Run real promptfoo (optional, local)

```bash
rm -rf .promptfoo
npx --yes promptfoo@latest eval -c evals/adherence.yaml --repeat 3
```

To actually exercise the LLM, swap `file://adherence-provider.cjs` in `adherence.yaml` for `anthropic:claude-opus-4-7` (or similar) and add a real test that spins up `basic-memory mcp` and asks the model to read/write notes.

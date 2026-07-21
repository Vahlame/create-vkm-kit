# Evaluations

Three distinct things live here. Keep them separate:

1. **Retrieval quality (`retrieval/`)** — a **real, measured** benchmark of the
   hybrid search: recall@k, MRR, hit@1, nDCG@k and MAP over a fixed labelled corpus.
   Deterministic (dependency-free embedder), so it gates CI and regressions fail the
   build.
2. **Token economy (`tokens/`)** — a **real, measured** benchmark of the kit's
   token claim: passage-first recall vs whole-note reads, completeness-gated.
   Deterministic, gates CI (ADR-0032).
3. **Adherence harness (`adherence.yaml` + `run-adherence-ci.mjs`)** — a **smoke
   test of the eval pipeline**, not a model-behaviour measurement (see below).

## 1. Retrieval quality — measured, gated

`retrieval/corpus/` is an 18-note fixture vault (PROJECTS / STACKS / PRACTICES /
RULES / MEMORY) with deliberately overlapping vocabulary; `retrieval/queries.jsonl`
labels 32 queries (lexical, conceptual-Spanish, OR-fallback, and **multi-relevant**)
with their ground-truth note paths. `obsidian_memory_rag.bench_recall` indexes the
corpus (FTS5 + vectors) and scores `hybrid_search` against the labels.

```bash
# human report
python -m obsidian_memory_rag bench-recall \
  --corpus evals/retrieval/corpus --queries evals/retrieval/queries.jsonl
# with the graph signal fused in
python -m obsidian_memory_rag bench-recall ... --graph
# CI gate (exits non-zero on regression)
python -m obsidian_memory_rag bench-recall ... \
  --assert-recall 0.95 --assert-mrr 0.90 --assert-hit1 0.90 \
  --assert-ndcg 0.93 --assert-map 0.93
```

**Measured floor** (default `HashingEmbedder`, dependency-free, reproducible):

| metric   | graph off | graph on |
| -------- | --------- | -------- |
| recall@5 | 1.000     | 0.984    |
| MRR      | 0.984     | 1.000    |
| hit@1    | 0.969     | 1.000    |
| nDCG@5   | 0.988     | 0.985    |
| MAP      | 0.984     | 0.979    |

These are the **lexical floor**; a neural embedder (`pip install
'obsidian-memory-rag[semantic]'`, `--embedder fastembed`) only raises the
conceptual-query numbers. The CI job `retrieval-bench` and
`tests/test_bench_recall.py` both gate on the graph-off floor with a margin.
The `graph on` column is the empirical case for ADR-0019/0021: link-fusion lifts the
hard OR-fallback queries from MRR 0.75 → 1.00 (and aggregate MRR/hit@1 to 1.000).
The slight graph-on recall trade (one displaced note in one adversarial
multi-relevant query) is why graph fusion enters **weighted** RRF at a tuned sub-1
weight (ADR-0021) and stays opt-in.

## 2. Token economy — measured, gated

`tokens/corpus/` is a 7-note fixture sized like a real vault (an 8.7 KB
`SESSION_LOG.md`, 4.4–5.5 KB PROJECTS notes, deliberately small <2 KB STACKS
notes as the honest counterpoint); `tokens/queries.jsonl` labels 16 queries with
the note(s) an agent would otherwise read whole. `obsidian_memory_rag.bench_tokens`
compares two arms per query — the top-k `heading + snippet` passages that
`vault_hybrid_search` actually returns vs every ground-truth note read whole —
with the methodology borrowed from the two tools evaluated in ADR-0032:

- **Honest control arm** (caveman): the whole-note arm already knows which note
  holds the answer (zero discovery cost), so the measured saving is a _floor_.
- **Completeness gate** (ponytail): a query's saving only counts when every
  ground-truth note surfaces in the top-k. Cheap-but-wrong is a miss, not a win.
- **Wire arm** (ADR-0034): the passage arm at its true cost — the compact JSON
  response the MCP actually emits (default hit shape + `count` + `_trust`
  notice), so JSON overhead is charged instead of hidden.

```bash
# human report
python -m obsidian_memory_rag bench-tokens \
  --corpus evals/tokens/corpus --queries evals/tokens/queries.jsonl
# CI gate (exits non-zero on regression)
python -m obsidian_memory_rag bench-tokens ... \
  --assert-savings 0.40 --assert-answered 0.95 --assert-wire-savings 0.30
```

**Measured floor** (default `HashingEmbedder`, ~4 bytes/token estimator on both
arms — the ratio is the signal, not the absolute count):

| k   | answered | median savings (content) | median savings (wire) |
| --- | -------- | ------------------------ | --------------------- |
| 3   | 100%     | 69%                      | 62%                   |
| 5   | 100%     | 47%                      | 37%                   |
| 10  | 100%     | 33%                      | 20%                   |

The **wire** column is what the kit claims: it counts the exact compact JSON
the agent reads (ADR-0034 moved ranking diagnostics behind `explain: true`,
saving ~20 tokens/hit, and dropped the MCP default `limit` 20→10 — measured
−37.8% on real-vault default recall calls, −60% on a broad query that hit the
old cap).

Two findings the per-kind breakdown keeps visible: on **small notes** (STACKS
bucket at k=5: −52%) reading whole is cheaper than k passages — matching the
doctrine "small notes whole, big notes never" — and **`limit` is the agent's
main token lever**: k=3 still answers everything here and saves strictly more
(`tests/test_bench_tokens.py` pins both as contracts, plus the wire-arm floor).
The CI job and the tests gate on the k=5 floor with a margin.

### Fixed costs are gated too (not here, but gated)

The wire benchmark covers the **per-call** cost. The kit's **fixed** per-session
costs live under package test suites, same doctrine (measured, build-gated):
`packages/obsidian-memory-mcp/test/schema-budget.test.mjs` (tool schemas ≤ 8,000
chars, ADR-0035) and
`packages/create-vkm-kit/test/memory-rules-budget.test.mjs` (rules block
budget + load-bearing phrases + docs drift, ADR-0036).

### End-to-end, latency, and the neural floor

Three surfaces added on top of the per-component gates:

- **`e2e-smoke`** (CI, every push): `scripts/e2e-smoke.mjs` runs the REAL stack in
  sequence — installer → Python index → hybrid MCP over stdio → search a seeded fact →
  `vault_write_file` a new note → reindex → find it. Proves the wiring, which no
  per-component bench can.
- **Latency**: `bench-recall --assert-p95-ms 500` gates per-query search p95 inside the
  `retrieval-bench` job (measured ~3 ms locally on the fixture corpus; the ceiling is
  deliberately loose — it catches accidental O(n²) ranking work, it is not a hardware
  benchmark).
- **Neural floor** (`.github/workflows/nightly-benchmarks.yml`, nightly + dispatch):
  the same corpus/queries on the **fastembed** embedder — the measured gate the
  semantic upgrade (ADR-0017/0026) never had. Floors are provisional until the first
  green run establishes the measured numbers; then they ratchet to (measured − 0.02).
- **Diagnostic preservation**: `packages/create-vkm-kit/test/compact-diagnostics.test.mjs`
  drives the token-saver's `compactText` over adversarial real-failure logs (error buried
  mid-stream in 900-line noisy output) and asserts the decisive line, its file:line, and
  every early diagnostic block survive. Shipping proof: this gate CAUGHT a real loss
  (detail lines adjacent to a keyword line were dropped) and forced the block-rescue fix.

### Known limits & the expansion roadmap (honest)

What round 1 established is **directional signal + anti-regression gates**, not
generalization claims. The known limits, and what the next rounds should vary:

- **Task diversity is the bottleneck, not n.** discipline/implementer share 2 tasks in
  2 domains; research-bench has 1 topic; diag has 3 fixtures. Before raising replicas,
  add tasks: 2+ new discipline domains (writing, infra), a second research topic in a
  non-DB domain with a different contradiction shape, 2+ diag fixtures whose decisive
  line does NOT match `MUST_KEEP_RE` (the adversarial case for the rescue pass).
- **Saturated cells stop teaching.** Triggering hit 100%/0% and explicit-spec cells hit
  100 everywhere — next rounds need harder distractors (near-miss prompts between
  vkm-spec and vkm-research; multi-skill prompts) and underspec variants, not more of
  the same.
- **Two models ≠ the model space.** Rounds ran Haiku + Sonnet; Opus and at least one
  non-Claude subject (via `--agent-cmd`, e.g. `codex exec` once available) would test
  whether the skills' gains are model-shaped.
- **Same-fixture overfitting.** The skills were improved against these fixtures; a
  held-out task per bench (written after the skill, never used to tune it) is the
  cheap defense.

Each of these is an additive round — the runners, graders and workflow already take
new tasks/fixtures without structural change.

## 3. Adherence harness (smoke only)

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

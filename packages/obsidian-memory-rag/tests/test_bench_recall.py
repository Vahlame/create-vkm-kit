"""Retrieval-quality gate.

These assertions are the measured floor of the kit's central claim. They run on
the dependency-free ``HashingEmbedder`` so they are deterministic and stable in
CI; a neural embedder only raises them. If a change to indexing, chunking, RRF or
the OR-fallback regresses retrieval, these fail. Thresholds sit a margin below the
measured numbers on the 32-query set (graph off: recall@5=1.000, MRR=0.984,
hit@1=0.969, nDCG@5=0.988, MAP=0.984) so they catch real regressions without
flaking on tiny corpus tweaks.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from obsidian_memory_rag import run_benchmark
from obsidian_memory_rag.bench_recall import evaluate, load_queries

# Repo layout: packages/obsidian-memory-rag/tests/<this> -> repo root is parents[3].
REPO_ROOT = Path(__file__).resolve().parents[3]
CORPUS = REPO_ROOT / "evals" / "retrieval" / "corpus"
QUERIES = REPO_ROOT / "evals" / "retrieval" / "queries.jsonl"

needs_fixture = pytest.mark.skipif(
    not (CORPUS.is_dir() and QUERIES.is_file()),
    reason="retrieval fixture (evals/retrieval) not present (package shipped standalone)",
)


@needs_fixture
def test_retrieval_quality_floor_no_graph() -> None:
    report = run_benchmark(CORPUS, QUERIES, k=5, graph=False)
    assert report.n >= 30, "golden set should be at/above the 30-query floor"
    assert report.recall_at_k >= 0.95, f"recall@5 regressed: {report.recall_at_k:.3f}"
    assert report.mrr >= 0.90, f"MRR regressed: {report.mrr:.3f}"
    assert report.hit_at_1 >= 0.90, f"hit@1 regressed: {report.hit_at_1:.3f}"
    assert report.ndcg_at_k >= 0.93, f"nDCG@5 regressed: {report.ndcg_at_k:.3f}"
    assert report.map >= 0.93, f"MAP regressed: {report.map:.3f}"
    # Every *positive* query must retrieve something relevant in the top-k (no hard
    # misses). Negative queries have no relevant note, so they are exempt.
    misses = [r.query for r in report.results if r.relevant and r.first_rank is None]
    assert not misses, f"hard misses: {misses}"


@needs_fixture
def test_negative_queries_excluded_from_aggregates() -> None:
    # Negative queries (no relevant note) must not drag the positive-query metrics:
    # they are summarized separately, not folded into recall/MRR/etc.
    report = run_benchmark(CORPUS, QUERIES, k=5, graph=False)
    assert report.negatives["n"] >= 1, "golden set should include negative queries"
    assert report.recall_at_k >= 0.95, "negatives must not lower the positive recall floor"
    # The negative summary reports the engine's confidence on no-answer queries.
    assert 0.0 <= report.negatives["abstain_rate"] <= 1.0
    assert "negative" not in report.by_kind, "negatives are not a positive bucket"


@needs_fixture
def test_graph_helps_precision_without_material_recall_loss() -> None:
    # Graph fusion (ADR-0019) enters weighted RRF at a tuned sub-1 weight (ADR-0021).
    # Measured contract: it lifts the or-fallback bucket it exists for and improves
    # aggregate MRR/hit@1, while a small, bounded recall trade is allowed (an
    # equal-weight graph term would displace a strong non-neighbour hit — that is
    # exactly what the down-weight prevents).
    base = run_benchmark(CORPUS, QUERIES, k=5, graph=False)
    graphed = run_benchmark(CORPUS, QUERIES, k=5, graph=True)
    assert graphed.mrr >= base.mrr
    assert graphed.hit_at_1 >= base.hit_at_1
    assert graphed.recall_at_k >= base.recall_at_k - 0.05
    # The reason graph fusion exists: nudge link-adjacent notes the lexical/semantic
    # pass under-ranks (the or-fallback queries).
    assert (
        graphed.by_kind["or-fallback"]["mrr"] > base.by_kind["or-fallback"]["mrr"]
    ), "graph fusion should strictly help the or-fallback bucket"


@needs_fixture
def test_benchmark_is_deterministic() -> None:
    a = run_benchmark(CORPUS, QUERIES, k=5, graph=False)
    b = run_benchmark(CORPUS, QUERIES, k=5, graph=False)
    assert (a.recall_at_k, a.mrr, a.hit_at_1, a.ndcg_at_k, a.map) == (
        b.recall_at_k,
        b.mrr,
        b.hit_at_1,
        b.ndcg_at_k,
        b.map,
    )


def test_metric_formulas_match_hand_computed() -> None:
    """Pin nDCG@k and MAP to hand-computed values (independent of the corpus)."""
    import math

    from obsidian_memory_rag.bench_recall import average_precision, ndcg_at_k

    # One relevant note, retrieved at rank 2 of 3.
    assert average_precision(["a", "b", "c"], {"b"}) == 0.5
    expected = (1 / math.log2(3)) / (1 / math.log2(2))  # DCG@k / IDCG@k
    assert abs(ndcg_at_k(["a", "b", "c"], {"b": 1.0}, 3) - expected) < 1e-9
    # Both relevant, retrieved in order → perfect.
    assert average_precision(["a", "b"], {"a", "b"}) == 1.0
    assert ndcg_at_k(["a", "b"], {"a": 1.0, "b": 1.0}, 2) == 1.0
    # Nothing relevant retrieved → zero (and no crash on an empty relevant set).
    assert average_precision(["x", "y"], {"z"}) == 0.0
    assert ndcg_at_k(["x", "y"], {"z": 1.0}, 2) == 0.0
    assert average_precision(["a"], set()) == 0.0


def test_evaluate_scoring_math(tmp_path: Path) -> None:
    """Unit-test the metric math against a hand-built index (no fixture needed)."""
    from obsidian_memory_rag import HashingEmbedder, index_vault, index_vectors

    vault = tmp_path / "v"
    (vault / "STACKS").mkdir(parents=True)
    (vault / "STACKS" / "go.md").write_text(
        "# go\n\nDaemon en Go con git sync y reintentos.\n", encoding="utf-8"
    )
    (vault / "STACKS" / "python.md").write_text(
        "# python\n\nMotor FTS5 con BM25 y embeddings.\n", encoding="utf-8"
    )
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    queries = [
        {"query": "daemon go git sync reintentos", "relevant": ["STACKS/go.md"], "kind": "lexical"},
        {"query": "FTS5 BM25 embeddings motor", "relevant": ["STACKS/python.md"], "kind": "lexical"},
    ]
    report = evaluate(vault, queries, emb, k=2)
    assert report.n == 2
    assert report.recall_at_k == 1.0
    assert report.hit_at_1 == 1.0
    assert report.mrr == 1.0
    assert report.ndcg_at_k == 1.0
    assert report.map == 1.0


def test_load_queries_rejects_malformed(tmp_path: Path) -> None:
    bad = tmp_path / "q.jsonl"
    bad.write_text('{"query": "x"}\n', encoding="utf-8")  # missing 'relevant'
    with pytest.raises(ValueError):
        load_queries(bad)

"""Retrieval-quality gate.

These assertions are the measured floor of the kit's central claim. They run on
the dependency-free ``HashingEmbedder`` so they are deterministic and stable in
CI; a neural embedder only raises them. If a change to indexing, chunking, RRF or
the OR-fallback regresses recall, these fail. Thresholds sit a margin below the
measured numbers (recall@5=1.000, MRR=0.972, hit@1=0.944 without graph) so they
catch real regressions without flaking on tiny corpus tweaks.
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
    assert report.n >= 15, "fixture should be non-trivial"
    assert report.recall_at_k >= 0.95, f"recall@5 regressed: {report.recall_at_k:.3f}"
    assert report.mrr >= 0.90, f"MRR regressed: {report.mrr:.3f}"
    assert report.hit_at_1 >= 0.90, f"hit@1 regressed: {report.hit_at_1:.3f}"
    # Every query must retrieve *something* relevant in the top-k (no hard misses).
    misses = [r.query for r in report.results if r.first_rank is None]
    assert not misses, f"hard misses: {misses}"


@needs_fixture
def test_graph_does_not_hurt_and_helps_or_fallback() -> None:
    # Graph fusion is a soft boost: it must never lower the aggregate metrics.
    base = run_benchmark(CORPUS, QUERIES, k=5, graph=False)
    graphed = run_benchmark(CORPUS, QUERIES, k=5, graph=True)
    assert graphed.mrr >= base.mrr
    assert graphed.hit_at_1 >= base.hit_at_1
    assert graphed.recall_at_k >= base.recall_at_k


@needs_fixture
def test_benchmark_is_deterministic() -> None:
    a = run_benchmark(CORPUS, QUERIES, k=5, graph=False)
    b = run_benchmark(CORPUS, QUERIES, k=5, graph=False)
    assert (a.recall_at_k, a.mrr, a.hit_at_1) == (b.recall_at_k, b.mrr, b.hit_at_1)


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


def test_load_queries_rejects_malformed(tmp_path: Path) -> None:
    bad = tmp_path / "q.jsonl"
    bad.write_text('{"query": "x"}\n', encoding="utf-8")  # missing 'relevant'
    with pytest.raises(ValueError):
        load_queries(bad)

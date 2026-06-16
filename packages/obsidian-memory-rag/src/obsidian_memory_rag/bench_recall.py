"""Retrieval-quality benchmark: recall@k, MRR and hit@1 over a labelled corpus.

This turns the kit's central claim — "the hybrid retrieval surfaces the right
note" — from *asserted* into *measured*. Given a fixed corpus of Markdown notes
and a query set with ground-truth relevant paths, it indexes the corpus
(FTS5 + vectors) and scores ``hybrid_search`` against the labels.

It is **deterministic**: with the default dependency-free ``HashingEmbedder`` the
numbers are reproducible across machines, so the metrics double as a CI
regression gate (see ``tests/test_bench_recall.py``) — not just a one-off report.
A neural embedder (``fastembed``) raises the conceptual-query numbers; the
hashing floor is what we gate on.

Metrics (averaged over the query set):
  - **recall@k**  — fraction of a query's relevant notes that appear in the top-k.
  - **MRR**       — mean reciprocal rank of the first relevant note (0 if missed).
  - **hit@1**     — fraction of queries whose top result is relevant.
  - **nDCG@k**    — position-discounted gain vs the ideal ordering (rewards putting
                    a relevant note at rank 1 over rank 3; stays < 1 even when
                    recall@k is saturated, so it discriminates ranking changes).
  - **MAP**       — mean Average Precision: precision averaged at each relevant
                    hit, then over queries. Sensitive to where *every* relevant
                    note lands, not just the first — the right gate for multi-
                    relevant queries.
"""

from __future__ import annotations

import json
import math
import shutil
import tempfile
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from .embeddings import get_embedder
from .indexer import index_vault, index_vectors
from .query import hybrid_search

if TYPE_CHECKING:
    from .embeddings import Embedder


def ndcg_at_k(ranked: list[str], gains: dict[str, float], k: int) -> float:
    """Normalized Discounted Cumulative Gain over a ranked path list (BEIR/MTEB).

    ``DCG@k = Σ (2^gain − 1) / log2(rank + 1)`` over the top-k, divided by the
    same sum for the ideal (gains sorted descending). Binary relevance is the
    special case where every relevant note has gain 1. Pure stdlib (``math.log2``).
    Returns 0.0 when there is no attainable gain.
    """
    dcg = math.fsum(
        (2 ** gains.get(d, 0.0) - 1) / math.log2(i + 1)
        for i, d in enumerate(ranked[:k], start=1)
    )
    ideal = sorted(gains.values(), reverse=True)[:k]
    idcg = math.fsum((2**g - 1) / math.log2(i + 1) for i, g in enumerate(ideal, start=1))
    return dcg / idcg if idcg else 0.0


def average_precision(ranked: list[str], relevant: set[str]) -> float:
    """Average Precision: mean of precision@i taken at each relevant hit.

    ``AP = (1/|R|) · Σ_i precision@i · rel(i)``. A relevant note missing from the
    ranked list contributes 0 (it is counted in ``|R|`` but never adds precision),
    so AP penalizes recall gaps as well as bad ordering. Returns 0.0 when the
    query has no relevant notes.
    """
    if not relevant:
        return 0.0
    hits = 0
    running = 0.0
    for i, d in enumerate(ranked, start=1):
        if d in relevant:
            hits += 1
            running += hits / i
    return running / len(relevant)


@dataclass
class QueryResult:
    query: str
    kind: str
    relevant: list[str]
    retrieved: list[str]  # top-k paths, best first
    first_rank: int | None  # 1-based rank of the first relevant hit, or None
    recall_at_k: float
    hit_at_1: bool
    ndcg_at_k: float
    average_precision: float


@dataclass
class BenchReport:
    k: int
    n: int
    embedder: str
    graph: bool
    mrr: float
    recall_at_k: float
    hit_at_1: float
    ndcg_at_k: float
    map: float
    by_kind: dict[str, dict[str, float]]
    results: list[QueryResult] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


def load_queries(path: Path) -> list[dict]:
    """Read a JSONL query set. Each line: {query, relevant: [paths], kind?}."""
    out: list[dict] = []
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        obj = json.loads(line)
        if "query" not in obj or "relevant" not in obj:
            raise ValueError(f"query line missing 'query'/'relevant': {line!r}")
        out.append(obj)
    if not out:
        raise ValueError(f"no queries found in {path}")
    return out


def evaluate(
    vault: Path,
    queries: list[dict],
    embedder: "Embedder",
    *,
    k: int = 5,
    graph: bool = False,
) -> BenchReport:
    """Score ``hybrid_search`` for each query against its ground-truth labels.

    Assumes ``vault`` is already indexed (FTS + vectors). Pure measurement — does
    not mutate the corpus.
    """
    results: list[QueryResult] = []
    for q in queries:
        relevant = set(q["relevant"])
        hits = hybrid_search(vault, q["query"], embedder, limit=k, graph=graph)
        retrieved = [h.path for h in hits]
        topk = retrieved[:k]
        first_rank: int | None = None
        for i, p in enumerate(topk, start=1):
            if p in relevant:
                first_rank = i
                break
        recall = len(relevant & set(topk)) / len(relevant) if relevant else 0.0
        gains = {p: 1.0 for p in relevant}
        results.append(
            QueryResult(
                query=q["query"],
                kind=str(q.get("kind", "?")),
                relevant=sorted(relevant),
                retrieved=topk,
                first_rank=first_rank,
                recall_at_k=recall,
                hit_at_1=first_rank == 1,
                ndcg_at_k=ndcg_at_k(topk, gains, k),
                average_precision=average_precision(topk, relevant),
            )
        )

    n = len(results)
    mrr = sum(1.0 / r.first_rank for r in results if r.first_rank) / n
    recall_at_k = sum(r.recall_at_k for r in results) / n
    hit_at_1 = sum(1.0 for r in results if r.hit_at_1) / n
    ndcg = sum(r.ndcg_at_k for r in results) / n
    mean_ap = sum(r.average_precision for r in results) / n

    buckets: dict[str, list[QueryResult]] = defaultdict(list)
    for r in results:
        buckets[r.kind].append(r)
    by_kind = {
        kind: {
            "n": len(rs),
            "mrr": sum(1.0 / r.first_rank for r in rs if r.first_rank) / len(rs),
            "recall_at_k": sum(r.recall_at_k for r in rs) / len(rs),
            "hit_at_1": sum(1.0 for r in rs if r.hit_at_1) / len(rs),
            "ndcg_at_k": sum(r.ndcg_at_k for r in rs) / len(rs),
            "map": sum(r.average_precision for r in rs) / len(rs),
        }
        for kind, rs in sorted(buckets.items())
    }

    return BenchReport(
        k=k,
        n=n,
        embedder=embedder.name,
        graph=graph,
        mrr=mrr,
        recall_at_k=recall_at_k,
        hit_at_1=hit_at_1,
        ndcg_at_k=ndcg,
        map=mean_ap,
        by_kind=by_kind,
        results=results,
    )


def run_benchmark(
    corpus: Path,
    queries_path: Path,
    *,
    k: int = 5,
    embedder_name: str | None = None,
    graph: bool = False,
    in_place: bool = False,
) -> BenchReport:
    """Index ``corpus`` and score it against ``queries_path``.

    By default the corpus is copied to a temp dir before indexing so the checked-in
    fixture stays pristine (no ``.obsidian-memory-rag/`` sidecar committed). Pass
    ``in_place=True`` to index the corpus where it lives.
    """
    embedder = get_embedder(embedder_name)
    queries = load_queries(queries_path)

    def _index_and_eval(vault: Path) -> BenchReport:
        index_vault(vault)
        index_vectors(vault, embedder)
        return evaluate(vault, queries, embedder, k=k, graph=graph)

    if in_place:
        return _index_and_eval(Path(corpus))

    with tempfile.TemporaryDirectory(
        prefix="recall-bench-", ignore_cleanup_errors=True
    ) as tmp:
        dst = Path(tmp) / "corpus"
        shutil.copytree(corpus, dst)
        return _index_and_eval(dst)


def format_report(report: BenchReport) -> str:
    """Human-readable one-screen summary."""
    lines = [
        f"retrieval bench: n={report.n} k={report.k} "
        f"embedder={report.embedder} graph={report.graph}",
        f"  recall@{report.k} = {report.recall_at_k:.3f}",
        f"  MRR        = {report.mrr:.3f}",
        f"  hit@1      = {report.hit_at_1:.3f}",
        f"  nDCG@{report.k}   = {report.ndcg_at_k:.3f}",
        f"  MAP        = {report.map:.3f}",
        "  by kind:",
    ]
    for kind, m in report.by_kind.items():
        lines.append(
            f"    {kind:<12} n={int(m['n'])} "
            f"recall@{report.k}={m['recall_at_k']:.3f} "
            f"mrr={m['mrr']:.3f} hit@1={m['hit_at_1']:.3f} "
            f"ndcg@{report.k}={m['ndcg_at_k']:.3f} map={m['map']:.3f}"
        )
    misses = [r for r in report.results if r.first_rank is None]
    if misses:
        lines.append(f"  misses ({len(misses)}):")
        for r in misses:
            lines.append(f"    [{r.kind}] {r.query!r} -> expected {r.relevant}")
    return "\n".join(lines)

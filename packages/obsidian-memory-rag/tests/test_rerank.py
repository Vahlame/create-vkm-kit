"""Cross-encoder reranker behaviour (ADR-0026), proven without a neural model.

A deterministic fake ``Reranker`` exercises the whole reorder + margin-cutoff +
fallback path in ``hybrid_search`` with zero dependencies. The real ``fastembed``
cross-encoder is smoke-tested separately (it downloads a model), not in CI.
"""

from __future__ import annotations

from pathlib import Path

from obsidian_memory_rag import HashingEmbedder, hybrid_search, index_vault, index_vectors
from obsidian_memory_rag.rerank import get_reranker


def _vault(tmp_path: Path):
    v = tmp_path / "v"
    (v / "STACKS").mkdir(parents=True)
    (v / "STACKS" / "go.md").write_text(
        "# go\n\nDaemon en Go con git sync y reintentos.\n", encoding="utf-8"
    )
    (v / "STACKS" / "python.md").write_text(
        "# python\n\nMotor FTS5 con BM25 y embeddings hashing.\n", encoding="utf-8"
    )
    (v / "STACKS" / "sqlite.md").write_text(
        "# sqlite\n\nWAL y online backup api error 14.\n", encoding="utf-8"
    )
    emb = HashingEmbedder(dim=256)
    index_vault(v)
    index_vectors(v, emb)
    return v, emb


class _KeywordReranker:
    """Scores a passage 5.0 if it contains ``kw`` (case-insensitive), else 0.0."""

    name = "fake"

    def __init__(self, kw: str) -> None:
        self.kw = kw.lower()

    def rerank(self, query: str, passages):
        return [5.0 if self.kw in p.lower() else 0.0 for p in passages]


class _BoomReranker:
    name = "boom"

    def rerank(self, query: str, passages):
        raise RuntimeError("model load failed")


def test_reranker_none_is_byte_identical(tmp_path: Path) -> None:
    v, emb = _vault(tmp_path)
    q = "go python sqlite"
    a = hybrid_search(v, q, emb, limit=5)
    b = hybrid_search(v, q, emb, limit=5, reranker=None)
    assert [h.path for h in a] == [h.path for h in b]
    assert all(h.rerank_score is None for h in b)


def test_reranker_reorders_to_keyword(tmp_path: Path) -> None:
    v, emb = _vault(tmp_path)
    hits = hybrid_search(
        v, "go python sqlite", emb, limit=5, reranker=_KeywordReranker("backup"), rerank_margin=None
    )
    assert hits[0].path == "STACKS/sqlite.md"  # only sqlite's passage mentions "backup"
    assert hits[0].rerank_score == 5.0


def test_reranker_margin_cuts_tail(tmp_path: Path) -> None:
    v, emb = _vault(tmp_path)
    hits = hybrid_search(
        v, "go python sqlite", emb, limit=5, reranker=_KeywordReranker("backup"), rerank_margin=2.0
    )
    # cutoff = top(5.0) - 2.0 = 3.0 → only the matching passage survives.
    assert [h.path for h in hits] == ["STACKS/sqlite.md"]


def test_reranker_failure_falls_back_to_fused(tmp_path: Path) -> None:
    v, emb = _vault(tmp_path)
    q = "go python sqlite"
    base = [h.path for h in hybrid_search(v, q, emb, limit=5)]
    out = [h.path for h in hybrid_search(v, q, emb, limit=5, reranker=_BoomReranker())]
    assert out == base  # search never breaks — it just un-reranks


def test_get_reranker_disabled_paths(monkeypatch) -> None:
    monkeypatch.delenv("OBSIDIAN_MEMORY_RERANK", raising=False)
    assert get_reranker(None) is None
    assert get_reranker("0") is None
    assert get_reranker("off") is None
    assert get_reranker("") is None

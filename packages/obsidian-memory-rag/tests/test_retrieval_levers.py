"""Deterministic unit tests for the opt-in retrieval levers (ADR-0026/0027).

Each lever (type-weighted graph, importance/in-degree, MMR diversification,
passage-window expansion) is off by default — the bench proves the *default* path
is byte-identical. These tests prove each lever's *mechanism* directly and
deterministically (no neural model, no flaky corpus), which is the honest way to
show levers that are situational by design rather than aggregate wins.
"""

from __future__ import annotations

import math
from array import array
from pathlib import Path

from obsidian_memory_rag import (
    HashingEmbedder,
    hybrid_search,
    index_vault,
    index_vectors,
)
from obsidian_memory_rag.graphlink import neighbor_paths, typed_neighbor_paths
from obsidian_memory_rag.paths import index_db_path
from obsidian_memory_rag.query import _mmr_order, _note_indegree
from obsidian_memory_rag.store import connect, init_schema


def _write(vault: Path, rel: str, text: str) -> None:
    fp = vault / rel
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(text, encoding="utf-8")


def _open(vault: Path):
    conn = connect(index_db_path(vault.resolve()))
    init_schema(conn)
    return conn


def _unit(*xs: float) -> array:
    v = array("f", xs)
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return array("f", (x / norm for x in v))


# --- Type-weighted graph (ADR-0027) ---------------------------------------------


def test_typed_neighbor_weights_strong_verb_above_weak(tmp_path: Path) -> None:
    """A `supersedes` neighbour outranks a `relates_to` one even when the weak link
    sorts earlier by path (untyped would put it first)."""
    v = tmp_path / "v"
    # `alpha` (relates_to) sorts before `zeta` (supersedes) lexicographically, so an
    # untyped +1 tie-break would rank alpha first; type weighting must flip that.
    _write(v, "PROJECTS/a.md", "# a\n\nProyecto A.\n\n- supersedes [[PROJECTS/zeta]]\n- relates_to [[PROJECTS/alpha]]\n")
    _write(v, "PROJECTS/zeta.md", "# zeta\n\nNota zeta.\n")
    _write(v, "PROJECTS/alpha.md", "# alpha\n\nNota alpha.\n")
    index_vault(v)
    conn = _open(v)
    try:
        typed = typed_neighbor_paths(conn, ["PROJECTS/a.md"], limit=10)
        untyped = neighbor_paths(conn, ["PROJECTS/a.md"], limit=10)
    finally:
        conn.close()
    assert typed.index("PROJECTS/zeta.md") < typed.index("PROJECTS/alpha.md")
    # The untyped path is flat (+1 each), so the lexicographic tie-break wins.
    assert untyped.index("PROJECTS/alpha.md") < untyped.index("PROJECTS/zeta.md")


def test_typed_neighbor_empty_without_relations(tmp_path: Path) -> None:
    v = tmp_path / "v"
    _write(v, "a.md", "# a\n\nSin enlaces.\n")
    index_vault(v)
    conn = _open(v)
    try:
        assert typed_neighbor_paths(conn, ["a.md"], limit=10) == []
    finally:
        conn.close()


# --- Importance / in-degree (ADR-0027) ------------------------------------------


def test_indegree_counts_incoming_links(tmp_path: Path) -> None:
    v = tmp_path / "v"
    _write(v, "STACKS/hub.md", "# hub\n\nNota muy enlazada.\n")
    for i in range(3):
        _write(v, f"PROJECTS/p{i}.md", f"# p{i}\n\n- uses [[STACKS/hub]]\n")
    index_vault(v)
    deg = _note_indegree(v, ["STACKS/hub.md", "PROJECTS/p0.md"])
    assert deg["STACKS/hub.md"] == 3
    assert deg["PROJECTS/p0.md"] == 0


def test_importance_promotes_hub_among_ties(tmp_path: Path) -> None:
    """With two comparably-relevant notes, importance lifts the more-linked one."""
    v = tmp_path / "v"
    # Two notes with the same topical text → near-tied relevance. `hub` is pointed
    # at by several others; `lonely` by none.
    body = "Pipeline de datos ETL ingesta transformacion carga.\n"
    _write(v, "STACKS/hub.md", f"# hub\n\n{body}")
    _write(v, "STACKS/lonely.md", f"# lonely\n\n{body}")
    for i in range(4):
        _write(v, f"PROJECTS/p{i}.md", f"# p{i}\n\n- uses [[STACKS/hub]]\n")
    emb = HashingEmbedder(dim=256)
    index_vault(v)
    index_vectors(v, emb)
    q = "pipeline de datos ETL ingesta transformacion"
    base = [h.path for h in hybrid_search(v, q, emb, limit=2)]
    boosted = [h.path for h in hybrid_search(v, q, emb, limit=2, importance=True)]
    # importance must not crash and must keep both candidates; the hub should not
    # rank below `lonely` once its centrality is counted.
    assert "STACKS/hub.md" in boosted
    assert boosted.index("STACKS/hub.md") <= base.index("STACKS/hub.md")


# --- MMR diversification (ADR-0028) ---------------------------------------------


def test_mmr_demotes_near_duplicate_for_a_novel_note() -> None:
    """Greedy MMR drops a near-duplicate of an already-selected hit in favour of a
    genuinely different note, even though the duplicate scores marginally higher."""
    fused = [("a", 0.030), ("b", 0.029), ("c", 0.028)]
    vecs = {
        "a": _unit(1.0, 0.0, 0.0),
        "b": _unit(0.99, 0.02, 0.0),  # nearly identical to a
        "c": _unit(0.0, 1.0, 0.0),  # orthogonal to a (novel)
    }
    out = [p for p, _ in _mmr_order(fused, vecs, lambda_=0.5, limit=2)]
    assert out[0] == "a"  # most relevant first
    assert out[1] == "c"  # novel note beats the near-duplicate b


def test_mmr_high_lambda_is_relevance_order() -> None:
    """At λ=1.0 MMR ignores diversity → pure relevance order."""
    fused = [("a", 0.030), ("b", 0.029), ("c", 0.028)]
    vecs = {"a": _unit(1.0, 0.0), "b": _unit(0.99, 0.02), "c": _unit(0.0, 1.0)}
    out = [p for p, _ in _mmr_order(fused, vecs, lambda_=1.0, limit=3)]
    assert out == ["a", "b", "c"]


# --- Passage-window expansion (ADR-0026 §passage-window) -------------------------


def test_passage_window_enriches_snippet_without_changing_ranking(tmp_path: Path) -> None:
    v = tmp_path / "v"
    # A multi-section note so adjacent chunks exist to fold in.
    _write(
        v,
        "STACKS/sqlite.md",
        "# sqlite\n\n"
        "## WAL\n\nWrite-Ahead Logging permite lecturas concurrentes durante escrituras.\n\n"
        "## Backup\n\nLa Online Backup API copia paginas en caliente sin bloquear.\n\n"
        "## Corrupcion\n\nUn fsync fallido o un apagado puede corromper la base.\n",
    )
    _write(v, "STACKS/go.md", "# go\n\nDaemon en Go con git sync.\n")
    emb = HashingEmbedder(dim=256)
    index_vault(v)
    index_vectors(v, emb)
    q = "WAL lecturas concurrentes durante escrituras"
    plain = hybrid_search(v, q, emb, limit=5)
    windowed = hybrid_search(v, q, emb, limit=5, passage_window=1)
    # Ranking (paths) is identical — passage_window only changes the returned text.
    assert [h.path for h in plain] == [h.path for h in windowed]
    top_plain = next(h for h in plain if h.path == "STACKS/sqlite.md")
    top_win = next(h for h in windowed if h.path == "STACKS/sqlite.md")
    assert len(top_win.snippet) >= len(top_plain.snippet)

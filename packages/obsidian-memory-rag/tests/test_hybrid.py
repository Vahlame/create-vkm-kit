from __future__ import annotations

from pathlib import Path

from obsidian_memory_rag import (
    HashingEmbedder,
    get_embedder,
    hybrid_search,
    index_vault,
    index_vectors,
    semantic_search,
)
from obsidian_memory_rag.query import reciprocal_rank_fusion


def _dot(u, v) -> float:
    return sum(x * y for x, y in zip(u, v))


def test_hashing_embedder_is_deterministic_and_normalized() -> None:
    emb = HashingEmbedder(dim=64)
    a1 = emb.embed(["deploy the service to production"])[0]
    a2 = emb.embed(["deploy the service to production"])[0]
    assert list(a1) == list(a2)  # deterministic across calls
    assert len(a1) == 64
    norm = sum(x * x for x in a1) ** 0.5
    assert abs(norm - 1.0) < 1e-5  # unit length

    # Related text scores higher than unrelated text under cosine (dot of unit vecs).
    base = emb.embed(["deployment release to production"])[0]
    near = emb.embed(["deploy the production service"])[0]
    far = emb.embed(["banana pancake breakfast recipe"])[0]
    assert _dot(base, near) > _dot(base, far)


def test_empty_text_embeds_to_zero_vector() -> None:
    emb = HashingEmbedder(dim=32)
    v = emb.embed([""])[0]
    assert len(v) == 32
    assert all(x == 0.0 for x in v)


def test_get_embedder_by_name() -> None:
    assert get_embedder("hashing").dim == 256
    assert get_embedder("hashing-128").dim == 128
    assert get_embedder("hashing").name == "hashing-256"


def test_reciprocal_rank_fusion_rewards_agreement() -> None:
    # "b" is rank 1 in both lists → must come first.
    fused = reciprocal_rank_fusion([["b", "a"], ["b", "c"]], limit=4)
    paths = [p for p, _ in fused]
    assert paths[0] == "b"
    assert set(paths) == {"a", "b", "c"}


def test_reciprocal_rank_fusion_weight_downweights_a_ranking() -> None:
    # Two rankings disagree (each tops its own item). Down-weighting the second
    # makes the first ranking's pick win — weighted RRF (Bruch et al. 2023).
    weighted = reciprocal_rank_fusion([["a"], ["b"]], weights=[1.0, 0.1], limit=2)
    assert weighted[0][0] == "a"
    assert weighted[0][1] > weighted[1][1]
    # Equal weights give equal score for a symmetric input (plain RRF, unchanged).
    equal = reciprocal_rank_fusion([["a"], ["b"]], weights=[1.0, 1.0], limit=2)
    assert {p for p, _ in equal} == {"a", "b"}
    assert equal[0][1] == equal[1][1]


def test_hybrid_recency_promotes_fresher_note(tmp_path: Path) -> None:
    import os
    import time

    vault = tmp_path / "v"
    vault.mkdir()
    body = "Decision sobre la politica de reintentos del daemon.\n"
    (vault / "old.md").write_text("# old\n\n" + body, encoding="utf-8")
    (vault / "new.md").write_text("# new\n\n" + body, encoding="utf-8")
    # Identical bodies → a pure-relevance tie. Make "old" a year older by mtime.
    now = time.time()
    year = 365 * 86400
    os.utime(vault / "old.md", (now - year, now - year))
    os.utime(vault / "new.md", (now, now))
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    q = "politica de reintentos del daemon"

    # Default (pure relevance): both surface; identical content → order not biased.
    base = hybrid_search(vault, q, emb, limit=2)
    assert {h.path for h in base} == {"old.md", "new.md"}

    # recency=True: the fresher note wins the tie via exponential time decay.
    recent = hybrid_search(vault, q, emb, limit=2, recency=True)
    assert recent[0].path == "new.md"


def _make_vault(tmp_path: Path) -> Path:
    vault = tmp_path / "vault"
    (vault / "notes").mkdir(parents=True)
    (vault / "notes" / "deploy.md").write_text(
        "# Deploy guide\n\nShipping the service to production with zero downtime.\n",
        encoding="utf-8",
    )
    (vault / "notes" / "food.md").write_text(
        "# Breakfast\n\nBananas and pancakes and coffee.\n",
        encoding="utf-8",
    )
    return vault


def test_index_vectors_is_incremental(tmp_path: Path) -> None:
    vault = _make_vault(tmp_path)
    emb = HashingEmbedder(dim=128)
    index_vault(vault)
    s1 = index_vectors(vault, emb)
    assert s1.embedded == 2
    assert s1.scanned == 2
    s2 = index_vectors(vault, emb)
    assert s2.embedded == 0
    assert s2.skipped_unchanged == 2


def test_index_vectors_prunes_deleted(tmp_path: Path) -> None:
    vault = _make_vault(tmp_path)
    emb = HashingEmbedder(dim=128)
    index_vault(vault)
    index_vectors(vault, emb)
    (vault / "notes" / "food.md").unlink()
    index_vault(vault)
    s = index_vectors(vault, emb)
    assert s.removed == 1
    hits = semantic_search(vault, "pancakes breakfast", emb, limit=5)
    assert all(h.path != "notes/food.md" for h in hits)


def test_semantic_search_ranks_by_relevance(tmp_path: Path) -> None:
    vault = _make_vault(tmp_path)
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    hits = semantic_search(vault, "production deployment downtime", emb, limit=2)
    assert hits
    assert hits[0].path == "notes/deploy.md"


def test_hybrid_search_fuses_both_signals(tmp_path: Path) -> None:
    vault = _make_vault(tmp_path)
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    hits = hybrid_search(vault, "deployment", emb, limit=5)
    assert hits
    top = hits[0]
    assert top.path == "notes/deploy.md"
    assert top.bm25_rank is not None or top.vector_rank is not None


def test_hybrid_search_without_vectors_is_pure_fts(tmp_path: Path) -> None:
    vault = _make_vault(tmp_path)
    emb = HashingEmbedder(dim=128)
    index_vault(vault)  # FTS only — no index_vectors call
    hits = hybrid_search(vault, "downtime", emb, limit=5)
    assert hits
    assert hits[0].path == "notes/deploy.md"
    assert hits[0].vector_rank is None  # nothing from the semantic side


def test_hybrid_returns_relevant_chunk_not_whole_note(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "guide.md").write_text(
        "# Guide\n\n"
        "## Deployment\n\nShip the service to production with zero downtime.\n\n"
        "## Cooking\n\nBananas and pancakes for a tasty breakfast.\n",
        encoding="utf-8",
    )
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    hits = hybrid_search(vault, "production deployment downtime", emb, limit=3)
    assert hits
    top = hits[0]
    assert top.path == "guide.md"
    # Token saver: the returned snippet is the matching section, not the whole note.
    assert "production" in top.snippet.lower()
    assert "pancakes" not in top.snippet.lower()
    assert top.heading == "Deployment"

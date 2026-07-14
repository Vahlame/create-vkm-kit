"""Tests for the research/memory retrieval scoping (spec vkm-research R4/R5).

``section`` restricts ``search_vault`` (FTS) and ``hybrid_search`` to
``RESEARCH/**`` ('research'), everything except it ('memory'), or is left
unfiltered (None, the default — byte-identical to the pre-section ranking).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from obsidian_memory_rag import (
    RESEARCH_PREFIX,
    HashingEmbedder,
    ensure_fresh,
    hybrid_search,
    index_vault,
    index_vectors,
    search_vault,
)


def _write(vault: Path, rel: str, text: str) -> None:
    fp = vault / rel
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(text, encoding="utf-8")


def _make_mixed_vault(tmp_path: Path) -> Path:
    """A vault with one RESEARCH source and one ordinary memory note sharing a topic."""
    vault = tmp_path / "vault"
    _write(
        vault,
        f"{RESEARCH_PREFIX}zoekt/sources/a1b2c3d4-overview.md",
        "# Overview\n\nWeb research: zoekt distributed search indexing internals.\n",
    )
    _write(
        vault,
        "PROJECTS/zoekt.md",
        "# zoekt\n\nDecided to adopt zoekt distributed search indexing for our repo.\n",
    )
    return vault


# --- search_vault (FTS) -----------------------------------------------------------


def test_search_vault_section_research_only(tmp_path: Path) -> None:
    vault = _make_mixed_vault(tmp_path)
    index_vault(vault)
    hits = search_vault(vault, "zoekt indexing", section="research")
    assert hits
    assert all(h.path.startswith(RESEARCH_PREFIX) for h in hits)


def test_search_vault_section_memory_excludes_research(tmp_path: Path) -> None:
    vault = _make_mixed_vault(tmp_path)
    index_vault(vault)
    hits = search_vault(vault, "zoekt indexing", section="memory")
    assert hits
    assert all(not h.path.startswith(RESEARCH_PREFIX) for h in hits)


def test_search_vault_section_none_matches_omitted_param(tmp_path: Path) -> None:
    vault = _make_mixed_vault(tmp_path)
    index_vault(vault)
    explicit = search_vault(vault, "zoekt indexing", section=None)
    omitted = search_vault(vault, "zoekt indexing")
    assert [(h.path, h.bm25, h.snippet) for h in explicit] == [
        (h.path, h.bm25, h.snippet) for h in omitted
    ]
    # Sanity: the unfiltered fixture really does span both sections.
    paths = {h.path for h in explicit}
    assert any(p.startswith(RESEARCH_PREFIX) for p in paths)
    assert any(not p.startswith(RESEARCH_PREFIX) for p in paths)


def test_search_vault_invalid_section_raises(tmp_path: Path) -> None:
    vault = _make_mixed_vault(tmp_path)
    index_vault(vault)
    with pytest.raises(ValueError):
        search_vault(vault, "zoekt", section="bogus")


# --- hybrid_search -----------------------------------------------------------------


def test_hybrid_search_section_research_only(tmp_path: Path) -> None:
    vault = _make_mixed_vault(tmp_path)
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    hits = hybrid_search(vault, "zoekt distributed search indexing", emb, limit=5, section="research")
    assert hits
    assert all(h.path.startswith(RESEARCH_PREFIX) for h in hits)


def test_hybrid_search_section_memory_excludes_research(tmp_path: Path) -> None:
    vault = _make_mixed_vault(tmp_path)
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    hits = hybrid_search(vault, "zoekt distributed search indexing", emb, limit=5, section="memory")
    assert hits
    assert all(not h.path.startswith(RESEARCH_PREFIX) for h in hits)


def test_hybrid_search_section_none_matches_omitted_param(tmp_path: Path) -> None:
    vault = _make_mixed_vault(tmp_path)
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    q = "zoekt distributed search indexing"
    explicit = hybrid_search(vault, q, emb, limit=5, section=None)
    omitted = hybrid_search(vault, q, emb, limit=5)
    assert [(h.path, h.score, h.bm25_rank, h.vector_rank) for h in explicit] == [
        (h.path, h.score, h.bm25_rank, h.vector_rank) for h in omitted
    ]


def test_hybrid_search_invalid_section_raises(tmp_path: Path) -> None:
    vault = _make_mixed_vault(tmp_path)
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    with pytest.raises(ValueError):
        hybrid_search(vault, "zoekt", emb, section="bogus")


def test_hybrid_search_graph_respects_section_filter(tmp_path: Path) -> None:
    """A [[wikilink]] neighbour one hop from a matched MEMORY note, but itself
    filed under RESEARCH/, must never leak into a section="memory" result even
    though the link graph itself is section-agnostic."""
    vault = tmp_path / "vault"
    _write(
        vault,
        f"{RESEARCH_PREFIX}search/sources/a1b2c3d4-deepdive.md",
        "# Deep dive\n\nInternals of distributed search indexing engines.\n",
    )
    _write(
        vault,
        "PROJECTS/zoekt.md",
        "# zoekt\n\nDecided to adopt zoekt for code search.\n\n"
        f"- uses [[{RESEARCH_PREFIX}search/sources/a1b2c3d4-deepdive]]\n",
    )
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    q = "zoekt code search"

    # Sanity: without a section filter, graph=True does pull the RESEARCH neighbour in.
    unfiltered = hybrid_search(vault, q, emb, limit=10, graph=True)
    assert any(h.path.startswith(RESEARCH_PREFIX) for h in unfiltered)

    # With section="memory", the RESEARCH neighbour must never appear.
    scoped = hybrid_search(vault, q, emb, limit=10, graph=True, section="memory")
    assert scoped
    assert all(not h.path.startswith(RESEARCH_PREFIX) for h in scoped)


# --- Loop integration (spec R5 acceptance criterion) --------------------------------


def test_research_note_persisted_directly_is_found_after_ensure_fresh(tmp_path: Path) -> None:
    """research -> persist -> ensure_fresh -> hybrid_search(section='research') finds
    the passage; section='memory' does not. Persistence itself is out of scope here
    (obscura-web); this writes the note the way that pipeline would, directly."""
    vault = tmp_path / "vault"
    vault.mkdir()
    _write(
        vault,
        f"{RESEARCH_PREFIX}widgets/sources/deadbeef-widget-materials.md",
        "---\n"
        "url: https://example.com/widgets\n"
        "title: Widget materials\n"
        "retrieved: 2026-07-14\n"
        "query: widget materials\n"
        "extraction: heuristic\n"
        "relevant: true\n"
        "origin: web\n"
        "---\n\n"
        "# Widget materials\n\n"
        "Titanium alloy widgets resist corrosion in marine environments.\n",
    )
    res = ensure_fresh(vault)
    assert res.fts.inserted == 1

    emb = HashingEmbedder(dim=128)
    q = "titanium alloy widgets corrosion"
    found = hybrid_search(vault, q, emb, limit=5, section="research")
    assert any(
        h.path == f"{RESEARCH_PREFIX}widgets/sources/deadbeef-widget-materials.md" for h in found
    )
    excluded = hybrid_search(vault, q, emb, limit=5, section="memory")
    assert not any(h.path.startswith(RESEARCH_PREFIX) for h in excluded)

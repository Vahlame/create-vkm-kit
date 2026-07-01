from __future__ import annotations

from pathlib import Path

from obsidian_memory_rag import (
    HashingEmbedder,
    hybrid_search,
    index_vault,
    index_vectors,
)
from obsidian_memory_rag.graphlink import extract_targets, neighbor_paths, normalize_target
from obsidian_memory_rag.paths import index_db_path
from obsidian_memory_rag.store import connect


def test_normalize_target_strips_alias_anchor_and_ext() -> None:
    assert normalize_target("Note#Heading|Label") == "note"
    assert normalize_target("PROJECTS/Foo.md") == "projects/foo"
    assert normalize_target("  Bar  ") == "bar"
    assert normalize_target("#only-anchor") == ""


def test_extract_targets_is_distinct_and_ordered() -> None:
    text = "see [[Alpha]] and [[beta|B]] and [[Alpha]] again"
    assert extract_targets(text) == ["alpha", "beta"]


def test_extract_targets_ignores_fenced_and_inline_code_examples() -> None:
    # A note documenting the wikilink syntax itself must not mint edges to targets
    # that were only ever mentioned as an EXAMPLE, not a real reference.
    text = (
        "Real link: [[Alpha]]\n\n"
        "Docs example inline: use `[[target]]` to link a note.\n\n"
        "```\n"
        "- implements [[adr-0014]]\n"
        "```\n"
    )
    assert extract_targets(text) == ["alpha"]


def _linked_vault(tmp_path: Path) -> Path:
    vault = tmp_path / "vault"
    (vault / "PROJECTS").mkdir(parents=True)
    (vault / "STACKS").mkdir(parents=True)
    (vault / "PROJECTS" / "inv.md").write_text(
        "# Inventory app\n\nThe warehouse inventory tool. Uses [[STACKS/sqlite]] for storage.\n",
        encoding="utf-8",
    )
    (vault / "STACKS" / "sqlite.md").write_text(
        "# sqlite\n\nEmbedded database. WAL journaling and the Online Backup API.\n",
        encoding="utf-8",
    )
    (vault / "PROJECTS" / "web.md").write_text(
        "# Website\n\nMarketing site, unrelated topic about pancakes.\n",
        encoding="utf-8",
    )
    return vault


def test_neighbor_paths_follows_outlinks_and_backlinks(tmp_path: Path) -> None:
    vault = _linked_vault(tmp_path)
    index_vault(vault)
    conn = connect(index_db_path(vault.resolve()))
    try:
        # Seed the project → the note it links to surfaces (out-edge).
        out = neighbor_paths(conn, ["PROJECTS/inv.md"])
        assert "STACKS/sqlite.md" in out
        assert "PROJECTS/inv.md" not in out  # seeds are excluded
        # Seed the stack note → the project that links to it surfaces (back-edge).
        back = neighbor_paths(conn, ["STACKS/sqlite.md"])
        assert "PROJECTS/inv.md" in back
    finally:
        conn.close()


def test_neighbor_paths_empty_for_unlinked_or_no_seeds(tmp_path: Path) -> None:
    vault = _linked_vault(tmp_path)
    index_vault(vault)
    conn = connect(index_db_path(vault.resolve()))
    try:
        assert neighbor_paths(conn, ["PROJECTS/web.md"]) == []
        assert neighbor_paths(conn, []) == []
    finally:
        conn.close()


def test_hybrid_graph_surfaces_linked_note(tmp_path: Path) -> None:
    vault = _linked_vault(tmp_path)
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    hits = hybrid_search(vault, "inventory warehouse", emb, limit=10, graph=True)
    by_path = {h.path: h for h in hits}
    # The stack note barely matches the query text, but it is one [[wikilink]] hop
    # from the strong "inventory" hit, so graph expansion pulls it in with a rank.
    assert "STACKS/sqlite.md" in by_path
    assert by_path["STACKS/sqlite.md"].graph_rank is not None


def test_hybrid_without_graph_assigns_no_graph_rank(tmp_path: Path) -> None:
    vault = _linked_vault(tmp_path)
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    hits = hybrid_search(vault, "inventory warehouse", emb, limit=10)  # graph=False
    assert hits
    assert all(h.graph_rank is None for h in hits)

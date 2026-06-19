from __future__ import annotations

from pathlib import Path

from obsidian_memory_rag import (
    index_vault,
    observations_query,
    relations_for,
    suggest_structure,
)
from obsidian_memory_rag.paths import index_db_path
from obsidian_memory_rag.store import connect, schema_version


def _kg_vault(tmp_path: Path) -> Path:
    vault = tmp_path / "vault"
    (vault / "docs").mkdir(parents=True)
    (vault / "STACKS").mkdir(parents=True)
    (vault / "docs" / "adr-0023.md").write_text(
        "# ADR-0023\n\n"
        "- implements [[adr-0014]]\n"
        "- supersedes [[adr-0019]] (replaced the rescan)\n"
        "- relates_to [[STACKS/python]]\n\n"
        "- [decision] weighted RRF graph weight 0.1 #ranking\n"
        "- [gotcha] dense RRF scores at k=60 #ranking #rrf\n",
        encoding="utf-8",
    )
    (vault / "docs" / "adr-0014.md").write_text(
        "# ADR-0014\n\nHybrid retrieval. See [[adr-0023]] for the typed layer.\n",
        encoding="utf-8",
    )
    (vault / "STACKS" / "python.md").write_text(
        "# python\n\n- [fact] stdlib-only RAG engine #stack\n",
        encoding="utf-8",
    )
    return vault


def test_index_populates_kg_and_sets_schema_version(tmp_path: Path) -> None:
    vault = _kg_vault(tmp_path)
    stats = index_vault(vault)
    assert stats.relations > 0
    assert stats.observations >= 3
    conn = connect(index_db_path(vault.resolve()))
    try:
        assert schema_version(conn) >= 2
    finally:
        conn.close()


def test_relations_out_resolves_targets(tmp_path: Path) -> None:
    vault = _kg_vault(tmp_path)
    index_vault(vault)
    out = relations_for(vault, "adr-0023", direction="out")
    by_type = {h.relation_type: h for h in out}
    assert by_type["implements"].target_path == "docs/adr-0014.md"
    assert by_type["supersedes"].context == "replaced the rescan"
    assert by_type["relates_to"].target_path == "STACKS/python.md"


def test_relations_in_finds_backlinks(tmp_path: Path) -> None:
    vault = _kg_vault(tmp_path)
    index_vault(vault)
    # adr-0014 is implemented-by adr-0023, and adr-0023 links back from adr-0014.
    incoming = relations_for(vault, "adr-0014", direction="in")
    sources = {(h.source_path, h.relation_type) for h in incoming}
    assert ("docs/adr-0023.md", "implements") in sources


def test_observations_query_by_category_and_tag(tmp_path: Path) -> None:
    vault = _kg_vault(tmp_path)
    index_vault(vault)
    decisions = observations_query(vault, category="decision")
    assert len(decisions) == 1
    assert "weighted RRF" in decisions[0].content

    ranking = observations_query(vault, tag="ranking")
    assert len(ranking) == 2  # the decision + the gotcha both carry #ranking

    # A tag substring must not leak: '#rank' is not '#ranking'.
    assert observations_query(vault, tag="rank") == []


def test_observations_query_by_note(tmp_path: Path) -> None:
    vault = _kg_vault(tmp_path)
    index_vault(vault)
    facts = observations_query(vault, note="STACKS/python")
    assert [o.category for o in facts] == ["fact"]


def test_suggest_structure_is_readonly_and_lists_existing(tmp_path: Path) -> None:
    vault = _kg_vault(tmp_path)
    index_vault(vault)
    result = suggest_structure(vault, "adr-0023")
    assert result["note"] == "docs/adr-0023.md"
    assert any(r["relation_type"] == "implements" for r in result["relations"])
    assert any(o["category"] == "decision" for o in result["observations"])
    assert "notice" in result  # the never-auto-write disclaimer


def test_deleting_a_note_prunes_its_kg_rows(tmp_path: Path) -> None:
    vault = _kg_vault(tmp_path)
    index_vault(vault)
    (vault / "STACKS" / "python.md").unlink()
    index_vault(vault)
    assert observations_query(vault, note="STACKS/python") == []
    # adr-0023's relates_to now resolves to nothing (target_path is None) but the
    # edge itself survives — it is the source note's own content.
    out = relations_for(vault, "adr-0023", direction="out")
    rel = next(h for h in out if h.relation_type == "relates_to")
    assert rel.target_path is None

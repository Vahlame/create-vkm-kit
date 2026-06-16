from __future__ import annotations

from pathlib import Path

from obsidian_memory_rag import index_vault, search_vault
from obsidian_memory_rag.query import build_match_query


def test_index_and_search_fts(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    (vault / "notes").mkdir(parents=True)
    (vault / "notes" / "alpha.md").write_text(
        "# Alpha title\n\nuniquekeyword banana for search.\n",
        encoding="utf-8",
    )
    (vault / "notes" / "beta.md").write_text(
        "# Beta\n\nother content without the magic phrase.\n",
        encoding="utf-8",
    )

    stats = index_vault(vault)
    assert stats.inserted == 2
    assert stats.scanned == 2

    hits = search_vault(vault, "uniquekeyword banana", limit=10)
    assert len(hits) == 1
    assert hits[0].path == "notes/alpha.md"
    assert "uniquekeyword" in hits[0].snippet or "banana" in hits[0].snippet

    stats2 = index_vault(vault)
    assert stats2.skipped_unchanged == 2
    assert stats2.inserted == 0


def test_index_updates_on_change(tmp_path: Path) -> None:
    vault = tmp_path / "v"
    vault.mkdir()
    p = vault / "doc.md"
    p.write_text("# One\noldtoken\n", encoding="utf-8")
    index_vault(vault)
    hits = search_vault(vault, "oldtoken")
    assert len(hits) == 1

    p.write_text("# One\nnewtoken\n", encoding="utf-8")
    index_vault(vault)
    assert not search_vault(vault, "oldtoken")
    assert search_vault(vault, "newtoken")


def test_removes_deleted_files(tmp_path: Path) -> None:
    vault = tmp_path / "v"
    vault.mkdir()
    a = vault / "a.md"
    a.write_text("# A\nkeepme\n", encoding="utf-8")
    b = vault / "b.md"
    b.write_text("# B\nremoveme\n", encoding="utf-8")
    index_vault(vault)
    assert search_vault(vault, "removeme")

    b.unlink()
    index_vault(vault)
    assert not search_vault(vault, "removeme")
    assert search_vault(vault, "keepme")


def test_build_match_query_and_or() -> None:
    # Default is AND (precision-first); OR is the recall fallback.
    assert build_match_query("alpha beta") == 'body: "alpha" AND body: "beta"'
    assert build_match_query("alpha beta", op="OR") == 'body: "alpha" OR body: "beta"'
    # Single term: AND and OR are identical (no joiner) — no wasted retry.
    assert build_match_query("alpha") == build_match_query("alpha", op="OR")
    assert build_match_query("   ") is None


def test_search_falls_back_to_or_when_and_misses(tmp_path: Path) -> None:
    vault = tmp_path / "v"
    vault.mkdir()
    (vault / "note.md").write_text(
        "# Deploy\n\nShipping the service to production.\n", encoding="utf-8"
    )
    index_vault(vault)
    # Both terms present in the note → strict AND finds it.
    assert search_vault(vault, "shipping production")
    # "kubernetes" is absent: strict AND would return nothing, but the OR
    # fallback still surfaces the note on the matching term ("production").
    hits = search_vault(vault, "production kubernetes")
    assert len(hits) == 1
    assert hits[0].path == "note.md"
    # A query where NO term matches still returns nothing (OR can't invent hits).
    assert search_vault(vault, "kubernetes terraform") == []

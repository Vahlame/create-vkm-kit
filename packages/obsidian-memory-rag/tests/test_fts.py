from __future__ import annotations

from pathlib import Path

from obsidian_memory_rag import index_vault, search_vault


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

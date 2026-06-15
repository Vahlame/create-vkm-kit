from __future__ import annotations

from pathlib import Path

from obsidian_memory_rag import complete, index_vault
from obsidian_memory_rag.complete import extract_tags
from obsidian_memory_rag.trie import Trie


def test_trie_completes_by_prefix_sorted_and_deduped() -> None:
    t = Trie()
    for w in ["beta", "best", "bet", "commit"]:
        t.insert(w)
    assert t.complete("be") == ["best", "bet", "beta"]
    assert t.complete("bet") == ["bet", "beta"]
    assert t.complete("z") == []


def test_trie_preserves_display_value() -> None:
    t = Trie()
    t.insert("sqlite", "#sqlite")  # matched case-folded, shown verbatim
    assert t.complete("sql") == ["#sqlite"]


def test_trie_limit_caps_results() -> None:
    t = Trie()
    for w in ["aa", "ab", "ac", "ad"]:
        t.insert(w)
    assert t.complete("a", limit=2) == ["aa", "ab"]


def test_extract_tags_skips_headings() -> None:
    body = "## Section heading\n\nUses #database and #sqlite, not ## Section.\n"
    assert extract_tags(body) == ["database", "sqlite"]


def test_complete_over_indexed_vault(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    (vault / "STACKS").mkdir(parents=True)
    (vault / "STACKS" / "sqlite.md").write_text(
        "# SQLite notes\n\nUses #database and #sqlite tags.\n", encoding="utf-8"
    )
    (vault / "STACKS" / "svelte.md").write_text(
        "# Svelte\n\nFrontend work, #frontend.\n", encoding="utf-8"
    )
    index_vault(vault)
    matches = complete(vault, "s", limit=20)
    assert "sqlite" in matches  # filename stem
    assert "svelte" in matches  # filename stem + title
    assert "#sqlite" in matches  # inline tag, shown with '#'


def test_complete_empty_when_unindexed(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    assert complete(vault, "any") == []

"""A research topic's content is indexed once, not twice.

``compiled-sources.md`` is the verbatim concatenation of every ``sources/*.md`` under a
research topic. Indexing it stored each passage twice — the duplicate competing with its
own original in BM25 and in the vector index — while adding nothing retrievable that the
source notes did not already carry.
"""

from __future__ import annotations

from pathlib import Path

from obsidian_memory_rag.audit import _iter_md_files
from obsidian_memory_rag.indexer import _iter_markdown_files
from obsidian_memory_rag.paths import GENERATED_SKIP_FILENAMES, is_generated_duplicate


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _vault(tmp_path: Path) -> Path:
    vault = tmp_path / "vault"
    _write(vault / "MEMORY.md", "# Memory\n")
    _write(
        vault / "RESEARCH" / "rust-async" / "sources" / "a1b2c3d4-tokio.md",
        "---\nurl: https://example.test/tokio\n---\n\nTokio is a runtime.\n",
    )
    _write(
        vault / "RESEARCH" / "rust-async" / "sources" / "e5f6a7b8-async-std.md",
        "---\nurl: https://example.test/async-std\n---\n\nasync-std is an alternative.\n",
    )
    # The generated merge: both bodies above, verbatim, in one file.
    _write(
        vault / "RESEARCH" / "rust-async" / "compiled-sources.md",
        "---\ntopic: rust-async\n---\n\n# rust-async — compiled sources\n\n"
        "## tokio\n\nTokio is a runtime.\n\n---\n\n## async-std\n\nasync-std is an alternative.\n",
    )
    _write(vault / "RESEARCH" / "rust-async" / "summary.md", "# Summary\n\nBoth exist.\n")
    return vault


def test_indexer_skips_the_generated_concatenation(tmp_path: Path) -> None:
    names = {p.name for p in _iter_markdown_files(_vault(tmp_path))}

    assert "compiled-sources.md" not in names
    # Nothing else was collateral damage: the sources it was merged from stay indexed, and
    # so does the hand-written summary that lives beside it.
    assert names == {"MEMORY.md", "a1b2c3d4-tokio.md", "e5f6a7b8-async-std.md", "summary.md"}


def test_audit_skips_exactly_what_retrieval_skips(tmp_path: Path) -> None:
    # The invariant that made the dot-directory divergence expensive: an audit that reports on
    # files the search engine cannot see reports permanent, false `index_drift.missing`.
    vault = _vault(tmp_path)

    assert {p.name for p in _iter_md_files(vault)} == {p.name for p in _iter_markdown_files(vault)}


def test_the_skip_list_is_matched_by_exact_filename(tmp_path: Path) -> None:
    assert is_generated_duplicate("compiled-sources.md")
    # Not a prefix or substring rule: a user's own note must never be swallowed by it.
    assert not is_generated_duplicate("compiled-sources-notes.md")
    assert not is_generated_duplicate("my-compiled-sources.md")
    assert not is_generated_duplicate("Compiled-Sources.md")
    assert GENERATED_SKIP_FILENAMES == frozenset({"compiled-sources.md"})

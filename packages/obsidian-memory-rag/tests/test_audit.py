from __future__ import annotations

import json
from pathlib import Path

from obsidian_memory_rag import audit_vault


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_oversized_flagged_above_budget(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    # ~4 bytes/token: 4000 bytes ~= 1000 tokens. Use a tiny budget so it trips.
    _write(vault / "big.md", "# Big\n\n" + ("x" * 4000))
    _write(vault / "small.md", "# Small\n\ntiny note\n")

    report = audit_vault(vault, budget_tokens=100)
    paths = [o["path"] for o in report["oversized"]]
    assert "big.md" in paths
    assert "small.md" not in paths
    # tokens estimate is ceil(bytes/4) and is reported per oversized note.
    big = next(o for o in report["oversized"] if o["path"] == "big.md")
    assert big["tokens"] > 100
    assert report["totals"]["notes"] == 2


def test_oversized_sorted_desc(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "a.md", "x" * 1000)
    _write(vault / "b.md", "x" * 5000)
    _write(vault / "c.md", "x" * 3000)
    report = audit_vault(vault, budget_tokens=100)
    tokens = [o["tokens"] for o in report["oversized"]]
    assert tokens == sorted(tokens, reverse=True)
    assert [o["path"] for o in report["oversized"]] == ["b.md", "c.md", "a.md"]


def test_broken_link_detected_valid_link_not_flagged(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "existing.md", "# Existing\n\nI am here.\n")
    _write(
        vault / "source.md",
        "# Source\n\nGood: [[Existing]]. Bad: [[Missing]].\n",
    )
    report = audit_vault(vault)
    broken = [(b["source"], b["target"]) for b in report["broken_links"]]
    assert ("source.md", "Missing") in broken
    assert all(b[1] != "Existing" for b in broken)


def test_broken_link_ignores_fenced_and_inline_code_examples(tmp_path: Path) -> None:
    # A note documenting the [[wikilink]] syntax with an example target that was
    # never meant to exist must not be flagged as a broken link.
    vault = tmp_path / "vault"
    _write(
        vault / "docs.md",
        "Use `[[target]]` to link a note.\n\n"
        "```\n"
        "- implements [[adr-0014]]\n"
        "```\n\n"
        "Real broken link: [[Missing]].\n",
    )
    report = audit_vault(vault)
    targets = [b["target"] for b in report["broken_links"]]
    assert targets == ["Missing"]


def test_oversized_and_broken_links_capped_with_total(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    for i in range(5):
        _write(vault / f"n{i}.md", f"# N{i}\n\n[[missing-{i}]]\n" + "x" * 1000)
    report = audit_vault(vault, budget_tokens=10, limit=2)
    assert len(report["oversized"]) == 2
    assert report["oversized_total"] == 5
    assert len(report["broken_links"]) == 2
    assert report["broken_links_total"] == 5


def test_wikilink_alias_and_section_are_stripped(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "target.md", "# Target\n")
    _write(
        vault / "ref.md",
        "[[Target#Heading|Nice Alias]] and [[Ghost#Sec|Label]]\n",
    )
    report = audit_vault(vault)
    targets = [b["target"] for b in report["broken_links"]]
    # Alias + section are stripped: Target resolves (not broken), Ghost is broken.
    assert "Target" not in targets
    assert "Ghost" in targets


def test_broken_link_case_insensitive(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "MyNote.md", "# MyNote\n")
    _write(vault / "ref.md", "[[mynote]] [[MYNOTE]]\n")
    report = audit_vault(vault)
    assert report["broken_links"] == []  # case-insensitive basename match


def test_path_qualified_links_resolve(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "PROJECTS" / "foo.md", "# Foo\n")
    _write(vault / "STACKS" / "bar.md", "# Bar\n")
    _write(
        vault / "ref.md",
        "[[PROJECTS/foo]] [[STACKS/bar]] [[PROJECTS/foo.md]] [[PROJECTS/missing]]\n",
    )
    report = audit_vault(vault)
    targets = [b["target"] for b in report["broken_links"]]
    # Folder-qualified links to existing notes resolve (by full path); the
    # explicit-.md form resolves too; only the truly-missing one is broken.
    assert "PROJECTS/foo" not in targets
    assert "STACKS/bar" not in targets
    assert "PROJECTS/missing" in targets


def test_session_log_token_count_and_over_threshold(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    # 8000 bytes ~= 2000 tokens; threshold 1000 -> over.
    _write(vault / "SESSION_LOG.md", "x" * 8000)
    report = audit_vault(vault, session_log_budget=1000)
    sl = report["session_log"]
    assert sl is not None
    assert sl["path"] == "SESSION_LOG.md"
    assert sl["tokens"] == 2000
    assert sl["over_threshold"] is True


def test_session_log_under_threshold(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "SESSION_LOG.md", "## 2026-06-14\n\nshort entry\n")
    report = audit_vault(vault, session_log_budget=6000)
    assert report["session_log"]["over_threshold"] is False


def test_session_log_absent_is_null(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "note.md", "# Note\n")
    report = audit_vault(vault)
    assert report["session_log"] is None


def test_excludes_tooling_dirs(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "real.md", "# Real\n")
    _write(vault / ".git" / "config.md", "x" * 9000)
    _write(vault / ".obsidian" / "plugin.md", "x" * 9000)
    _write(vault / ".obsidian-memory-rag" / "junk.md", "x" * 9000)
    report = audit_vault(vault, budget_tokens=10)
    assert report["totals"]["notes"] == 1
    assert all(o["path"] == "real.md" for o in report["oversized"])


def test_report_is_json_serializable_with_exact_shape(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "a.md", "[[Missing]]\n" + "x" * 5000)
    _write(vault / "SESSION_LOG.md", "## entry\n")
    report = audit_vault(vault, budget_tokens=100)
    # Round-trips through json with non-ASCII safety, and keeps the documented keys.
    dumped = json.dumps(report, ensure_ascii=False)
    again = json.loads(dumped)
    assert set(again) == {
        "budget_tokens",
        "totals",
        "oversized",
        "oversized_total",
        "broken_links",
        "broken_links_total",
        "session_log",
    }
    assert set(again["totals"]) == {"notes", "tokens"}
    assert again["budget_tokens"] == 100

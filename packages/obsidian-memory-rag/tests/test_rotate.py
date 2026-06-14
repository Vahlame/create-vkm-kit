from __future__ import annotations

from pathlib import Path

from obsidian_memory_rag import rotate_session_log


def _make_log(vault: Path, n: int, *, preamble: str = "") -> Path:
    """Write SESSION_LOG.md with ``n`` h2 sections numbered oldest..newest."""
    vault.mkdir(parents=True, exist_ok=True)
    parts = [preamble] if preamble else []
    for i in range(n):
        parts.append(f"## 2026-06-{i + 1:02d} — entry {i}\n\nbody for entry {i}\n\n")
    log = vault / "SESSION_LOG.md"
    log.write_text("".join(parts), encoding="utf-8")
    return log


def test_keeps_newest_and_archives_older(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    log = _make_log(vault, 12)

    res = rotate_session_log(vault, keep=8)

    assert res.changed is True
    assert res.sections_total == 12
    assert res.kept == 8
    assert res.archived == 4

    kept_text = log.read_text(encoding="utf-8")
    # Newest 8 sections (entries 4..11) remain; oldest 4 (entries 0..3) gone.
    assert kept_text.count("## ") == 8
    assert "entry 11" in kept_text
    assert "entry 4" in kept_text
    assert "entry 3" not in kept_text
    assert "entry 0" not in kept_text

    archive = vault / "SESSION_LOG" / "archive.md"
    assert archive.is_file()
    archive_text = archive.read_text(encoding="utf-8")
    assert archive_text.count("## ") == 4
    for i in range(4):
        assert f"entry {i}" in archive_text
    # Archived order is preserved (oldest first).
    assert archive_text.index("entry 0") < archive_text.index("entry 3")


def test_content_is_preserved_no_loss(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    log = _make_log(vault, 12)
    original = log.read_text(encoding="utf-8")

    rotate_session_log(vault, keep=8)

    kept = log.read_text(encoding="utf-8")
    archived = (vault / "SESSION_LOG" / "archive.md").read_text(encoding="utf-8")
    # Every original section body survives somewhere (no deletion).
    for i in range(12):
        marker = f"body for entry {i}"
        assert marker in kept or marker in archived
    # Reassembling archive + kept reproduces the original section stream.
    assert archived + kept == original


def test_preamble_stays_in_log(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    log = _make_log(vault, 12, preamble="# Session Log\n\nIntro paragraph.\n\n")

    rotate_session_log(vault, keep=8)

    kept = log.read_text(encoding="utf-8")
    assert kept.startswith("# Session Log\n\nIntro paragraph.")
    archive = (vault / "SESSION_LOG" / "archive.md").read_text(encoding="utf-8")
    assert "Intro paragraph" not in archive  # preamble never moves


def test_dry_run_writes_nothing(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    log = _make_log(vault, 12)
    before = log.read_text(encoding="utf-8")

    res = rotate_session_log(vault, keep=8, dry_run=True)

    assert res.changed is False
    assert res.kept == 8
    assert res.archived == 4
    # File untouched and no archive created.
    assert log.read_text(encoding="utf-8") == before
    assert not (vault / "SESSION_LOG").exists()


def test_noop_when_at_or_below_keep(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    log = _make_log(vault, 8)
    before = log.read_text(encoding="utf-8")

    res = rotate_session_log(vault, keep=8)

    assert res.changed is False
    assert res.archived == 0
    assert log.read_text(encoding="utf-8") == before
    assert not (vault / "SESSION_LOG").exists()


def test_missing_log_is_noop(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    res = rotate_session_log(vault, keep=8)
    assert res.changed is False
    assert res.sections_total == 0


def test_archive_appends_across_runs(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    # First run: 12 sections, keep 8 -> archive 4 (entries 0..3).
    _make_log(vault, 12)
    rotate_session_log(vault, keep=8)
    archive = vault / "SESSION_LOG" / "archive.md"
    first = archive.read_text(encoding="utf-8")
    assert first.count("## ") == 4

    # Append 5 brand-new sections, then rotate again with the same keep.
    log = vault / "SESSION_LOG.md"
    extra = "".join(
        f"## 2026-07-{i + 1:02d} — new {i}\n\nnew body {i}\n\n" for i in range(5)
    )
    log.write_text(log.read_text(encoding="utf-8") + extra, encoding="utf-8")
    rotate_session_log(vault, keep=8)

    second = archive.read_text(encoding="utf-8")
    # Earlier archived content is preserved; more sections were appended.
    assert "entry 0" in second
    assert second.count("## ") > first.count("## ")

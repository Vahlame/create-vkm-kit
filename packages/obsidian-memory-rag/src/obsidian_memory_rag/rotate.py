"""Rotate SESSION_LOG.md: keep the newest N sections, archive the rest (D3).

``SESSION_LOG.md`` is an append-only timeline: any free-form preamble, then a run
of top-level sections each opened by a ``^## `` line (e.g. ``## 2026-06-14 — proj``).
Newest sections are appended at the END. This module keeps the most recent ``keep``
sections in place and *moves* (never deletes) the older ones into
``SESSION_LOG/archive.md``, preserving their original order. Writes are atomic
(tmp file + ``os.replace``) so a crash can never leave a half-written log.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

SESSION_LOG_NAME = "SESSION_LOG.md"
ARCHIVE_DIR_NAME = "SESSION_LOG"
ARCHIVE_FILE_NAME = "archive.md"

# A top-level section starts at a line beginning with "## " (h2). Multiline so it
# matches at the start of any line, not just the file.
_SECTION_RE = re.compile(r"^## ", re.MULTILINE)


@dataclass
class RotateResult:
    sections_total: int
    kept: int
    archived: int
    archive_path: Path
    changed: bool  # False => no-op (<= keep sections) or dry-run


def _split_sections(text: str) -> tuple[str, list[str]]:
    """Split log text into (preamble, [section, ...]).

    ``preamble`` is everything before the first ``^## `` (may be empty). Each
    section string starts at its ``## `` line and runs up to (but not including)
    the next one, so concatenating preamble + all sections reproduces ``text``.
    """
    starts = [m.start() for m in _SECTION_RE.finditer(text)]
    if not starts:
        return text, []
    preamble = text[: starts[0]]
    sections: list[str] = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(text)
        sections.append(text[start:end])
    return preamble, sections


def _atomic_write(path: Path, content: str) -> None:
    """Write ``content`` to ``path`` atomically (tmp in same dir + ``os.replace``)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    tmp.write_text(content, encoding="utf-8", newline="")
    os.replace(tmp, path)


def rotate_session_log(
    vault: Path,
    *,
    keep: int = 8,
    dry_run: bool = False,
) -> RotateResult:
    """Keep the newest ``keep`` sections in SESSION_LOG.md, archive older ones.

    No-ops (``changed=False``) when the log is missing, has no sections, or has
    ``<= keep`` sections. With ``dry_run=True`` nothing is written but the result
    reflects what *would* move.
    """
    vault = vault.resolve()
    log_path = vault / SESSION_LOG_NAME
    archive_path = vault / ARCHIVE_DIR_NAME / ARCHIVE_FILE_NAME

    if not log_path.is_file():
        return RotateResult(0, 0, 0, archive_path, changed=False)

    text = log_path.read_text(encoding="utf-8-sig")
    preamble, sections = _split_sections(text)
    total = len(sections)

    if total <= keep:
        return RotateResult(total, total, 0, archive_path, changed=False)

    split_at = total - keep
    older = sections[:split_at]  # archive these (oldest, original order)
    newest = sections[split_at:]  # keep these in SESSION_LOG.md

    if dry_run:
        return RotateResult(total, len(newest), len(older), archive_path, changed=False)

    # Append older sections to the archive, preserving prior archive content.
    existing_archive = ""
    if archive_path.is_file():
        existing_archive = archive_path.read_text(encoding="utf-8-sig")
    archive_body = "".join(older)
    if existing_archive and not existing_archive.endswith("\n"):
        existing_archive += "\n"
    _atomic_write(archive_path, existing_archive + archive_body)

    # Rewrite SESSION_LOG.md with preamble + the newest sections only.
    _atomic_write(log_path, preamble + "".join(newest))

    return RotateResult(total, len(newest), len(older), archive_path, changed=True)

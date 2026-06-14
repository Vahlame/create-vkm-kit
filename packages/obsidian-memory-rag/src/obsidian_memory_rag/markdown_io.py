"""Read Markdown files for indexing."""

from __future__ import annotations

from pathlib import Path


def split_title_body(raw: str) -> tuple[str, str]:
    lines = raw.splitlines()
    title = ""
    body_start = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("#"):
            title = stripped.lstrip("#").strip()
            body_start = i + 1
            break
    body = "\n".join(lines[body_start:]).strip()
    if not title and lines:
        title = lines[0].strip()[:200]
    return title, body


def read_note(path: Path, max_bytes: int) -> tuple[str, str]:
    data = path.read_bytes()
    if len(data) > max_bytes:
        data = data[:max_bytes]
    # utf-8-sig strips a leading BOM that some editors (and PowerShell) emit, so
    # it never leaks into the note title or the FTS body.
    raw = data.decode("utf-8-sig", errors="replace")
    title, body = split_title_body(raw)
    return title, body

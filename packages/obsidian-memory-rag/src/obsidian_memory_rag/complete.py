"""Prefix autocompletion over note titles, filenames and inline ``#tags``.

Backed by :class:`.trie.Trie`. Completion sources come from the FTS index that
search already keeps fresh, so it adds no extra file I/O: note titles and path
stems from ``vault_fts``, plus inline ``#tags`` parsed from note bodies. (Tags in
YAML frontmatter are not indexed and are therefore out of scope here.)

Matching is case-insensitive; the original display form is returned — titles and
stems verbatim, tags rendered as ``#tag``.
"""

from __future__ import annotations

import re
from pathlib import Path

from .paths import index_db_path
from .store import connect, init_schema
from .trie import Trie

# Inline hashtag: a '#' at a word boundary followed by a tag char. The leading
# (?:^|\s) guard skips Markdown headings ('## Section' — the second '#' is not a
# tag char) and mid-word '#'. Tags may nest with '/' (Obsidian) or '-'.
_TAG_RE = re.compile(r"(?:^|\s)#([A-Za-z0-9][\w/-]*)")


def extract_tags(text: str) -> list[str]:
    """Distinct inline ``#tags`` in a note body, without the ``#`` (first-seen)."""
    seen: dict[str, None] = {}
    for match in _TAG_RE.finditer(text):
        tag = match.group(1)
        if tag and tag not in seen:
            seen[tag] = None
    return list(seen)


def build_completion_trie(vault: Path) -> Trie:
    """Build a Trie of note titles, filename stems and inline ``#tags``.

    Reads the existing FTS index; returns an empty Trie when no index exists yet
    (the caller's auto-index refresh normally builds it first).
    """
    vault = vault.resolve()
    db_path = index_db_path(vault)
    trie = Trie()
    if not db_path.is_file():
        return trie
    conn = connect(db_path)
    try:
        init_schema(conn)
        rows = conn.execute("SELECT path, title, body FROM vault_fts").fetchall()
    finally:
        conn.close()

    for r in rows:
        path = str(r["path"])
        stem = path.rsplit("/", 1)[-1]
        if stem.lower().endswith(".md"):
            stem = stem[:-3]
        title = str(r["title"] or "").strip()
        if title:
            trie.insert(title.lower(), title)
        if stem:
            trie.insert(stem.lower(), stem)
        for tag in extract_tags(str(r["body"] or "")):
            trie.insert(tag.lower(), f"#{tag}")
    return trie


def complete(vault: Path, prefix: str, *, limit: int = 20) -> list[str]:
    """Return up to ``limit`` titles/filenames/tags starting with ``prefix``."""
    return build_completion_trie(vault).complete(prefix.strip().lower(), limit=limit)

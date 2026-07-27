"""Prefix autocompletion over note titles, filenames and inline ``#tags``.

Backed by :class:`.trie.Trie`. Completion sources come from the FTS index that
search already keeps fresh, so it adds no extra file I/O: note titles and path
stems from ``vault_fts``, plus inline ``#tags`` parsed from note bodies. (Tags in
YAML frontmatter are not indexed and are therefore out of scope here.)

Matching is case-insensitive; the original display form is returned — titles and
stems verbatim, tags rendered as ``#tag``.
"""

from __future__ import annotations

from pathlib import Path

from .paths import index_db_path
from .store import connect, init_schema
from .tags import extract_tags as shared_extract_tags
from .text_scrub import strip_code_regions
from .trie import Trie

# Re-exported so `from .complete import extract_tags` keeps working; the definition
# (and the ONE regex the whole engine agrees on) lives in tags.py. The copy this
# replaced used a `(?:^|\s)` guard instead of a lookbehind, so it silently missed a
# tag in parentheses — `(#paren)` — that knowledge_graph.py had already indexed.
extract_tags = shared_extract_tags


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
        for tag in extract_tags(strip_code_regions(str(r["body"] or ""))):
            trie.insert(tag.lower(), f"#{tag}")
    return trie


def complete(vault: Path, prefix: str, *, limit: int = 20) -> list[str]:
    """Return up to ``limit`` titles/filenames/tags starting with ``prefix``."""
    return build_completion_trie(vault).complete(prefix.strip().lower(), limit=limit)

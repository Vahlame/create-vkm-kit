"""Filesystem layout for the SQLite sidecar beside a vault."""

from __future__ import annotations

from pathlib import Path

SIDECAR_DIR = ".obsidian-memory-rag"
DB_NAME = "fts.sqlite"

# Single source of truth for the research-vs-memory retrieval boundary (spec
# vkm-research R4): the vault-relative path prefix that marks a note as
# persisted web research rather than personal memory. Both query.py (FTS +
# hybrid search) and vector_store.py (semantic candidate collection) key off
# this one constant so the boundary can never drift between the two paths.
RESEARCH_PREFIX = "RESEARCH/"


def sidecar_dir(vault: Path) -> Path:
    return vault / SIDECAR_DIR


def index_db_path(vault: Path) -> Path:
    return sidecar_dir(vault) / DB_NAME


def validate_section(section: str | None) -> None:
    """Raise ValueError for any ``section`` outside ``{None, 'research', 'memory'}``.

    Boundary check for the retrieval-scoping param (R4): a typo or stray value
    must fail loudly, never silently fall through to "unfiltered".
    """
    if section is not None and section not in ("research", "memory"):
        raise ValueError(f"section must be 'research', 'memory', or None (got {section!r})")


def in_section(path: str, section: str | None) -> bool:
    """True if vault-relative ``path`` belongs to ``section``.

    ``'research'`` = only :data:`RESEARCH_PREFIX`; ``'memory'`` = everything
    else; ``None`` = unfiltered (every path matches — the byte-identical
    default). Assumes ``section`` was already checked by :func:`validate_section`.
    """
    if section is None:
        return True
    is_research = path.startswith(RESEARCH_PREFIX)
    return is_research if section == "research" else not is_research


def section_sql_filter(section: str | None, *, column: str = "path") -> tuple[str, list[str]]:
    """SQL fragment + bound params expressing :func:`in_section` at the query layer.

    Returns ``("", [])`` when unfiltered, else ``" AND <column> {NOT }LIKE ?"``
    plus the ``RESEARCH_PREFIX`` glob pattern — shared by ``search_vault`` (FTS)
    and the sqlite-vec accelerated chunk search so both filter candidates
    *before* their ``LIMIT``, not after (a post-filter would silently return
    fewer than the requested limit).
    """
    if section is None:
        return "", []
    op = "LIKE" if section == "research" else "NOT LIKE"
    return f" AND {column} {op} ?", [f"{RESEARCH_PREFIX}%"]

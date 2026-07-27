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

# Generated files whose ENTIRE content already exists elsewhere in the vault, indexed
# under its own path. Skipped by name at any depth.
#
# `compiled-sources.md` (obscura's research pipeline, `writeCompiled`) is the verbatim
# concatenation of every `RESEARCH/<topic>/sources/*.md`. Indexing it stores each topic
# TWICE: once per source note and once inside the merged file. The cost is not only disk
# — the duplicate chunks compete with their own originals in BM25 and in the vector
# index, so a topic with a big compiled file can return the same passage twice and push
# a different source out of the top-k.
#
# Skipping it loses no recall: every passage remains retrievable through the source note
# it came from, which additionally carries the url/author/retrieved frontmatter that the
# merged rendering flattens into a text line. The merged file is a READING artifact — one
# scroll through everything gathered — not a retrieval unit.
#
# Note for an existing vault: rows written before this list existed are removed by the
# next indexing pass. Until then `index_drift` reports them as `orphaned`, which is what
# they now are.
GENERATED_SKIP_FILENAMES = frozenset({"compiled-sources.md"})


def is_generated_duplicate(name: str) -> bool:
    """True for a generated file whose content is already indexed under its own source."""
    return name in GENERATED_SKIP_FILENAMES


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

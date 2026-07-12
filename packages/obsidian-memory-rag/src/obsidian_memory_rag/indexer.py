"""Incremental FTS5 indexer for Markdown vaults."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from .chunking import split_into_chunks
from .knowledge_graph import parse_observations, parse_relations
from .markdown_io import read_note
from .paths import index_db_path
from .store import (
    SCHEMA_VERSION,
    connect,
    init_schema,
    schema_version,
    set_schema_version,
)
from .vector_store import (
    current_chunk_keys,
    delete_chunks_for_path,
    dominant_embedder_name,
    has_any_chunks,
    init_chunks,
    upsert_chunk,
)

if TYPE_CHECKING:
    from .embeddings import Embedder


SKIP_DIR_NAMES = frozenset(
    {
        ".git",
        "node_modules",
        ".obsidian",
        ".obsidian-memory-rag",
        "__pycache__",
        ".venv",
        "venv",
        ".mypy_cache",
        ".pytest_cache",
    }
)


@dataclass
class IndexStats:
    scanned: int = 0
    inserted: int = 0
    updated: int = 0
    skipped_unchanged: int = 0
    removed: int = 0
    truncated: int = 0
    relations: int = 0  # typed + untyped edges written this run
    observations: int = 0  # structured observations written this run


def _should_skip_dir(path: Path) -> bool:
    return path.name in SKIP_DIR_NAMES or path.name.startswith(".")


def _iter_markdown_files(vault: Path) -> list[Path]:
    out: list[Path] = []
    for root, dirnames, filenames in os.walk(vault):
        root_path = Path(root)
        dirnames[:] = [d for d in dirnames if not _should_skip_dir(root_path / d)]
        for name in filenames:
            if not name.endswith(".md"):
                continue
            fp = root_path / name
            if fp.is_file():
                out.append(fp)
    return out


def _rel_posix(vault: Path, file_path: Path) -> str:
    rel = file_path.relative_to(vault)
    return rel.as_posix()


def _stat_key(path: Path) -> tuple[int, int] | None:
    try:
        st = path.stat()
    except OSError:
        return None
    return int(st.st_mtime_ns), int(st.st_size)


def _index_note_kg(conn, rel: str, title: str, body: str) -> int:
    """Rebuild ``relations`` rows for one note; return how many were written."""
    conn.execute("DELETE FROM relations WHERE source_path = ?", (rel,))
    written = 0
    for r in parse_relations(f"{title}\n{body}"):
        conn.execute(
            "INSERT OR IGNORE INTO relations(source_path, relation_type, target, context) "
            "VALUES (?, ?, ?, ?)",
            (rel, r.relation_type, r.target, r.context),
        )
        written += 1
    return written


def _index_note_observations(conn, rel: str, body: str) -> int:
    """Rebuild ``observations`` rows for one note; return how many were written."""
    conn.execute("DELETE FROM observations WHERE source_path = ?", (rel,))
    written = 0
    for i, o in enumerate(parse_observations(body)):
        conn.execute(
            "INSERT OR IGNORE INTO observations(source_path, ordinal, category, content, tags) "
            "VALUES (?, ?, ?, ?, ?)",
            (rel, i, o.category, o.content, " ".join(o.tags)),
        )
        written += 1
    return written


def index_vault(
    vault: Path,
    *,
    max_file_bytes: int = 1_048_576,
    batch_commit_every: int = 64,
) -> IndexStats:
    """Build or refresh the FTS5 index under ``vault/.obsidian-memory-rag/``."""
    vault = vault.resolve()
    db_path = index_db_path(vault)
    stats = IndexStats()
    conn = connect(db_path)
    try:
        init_schema(conn)
        conn.execute("BEGIN IMMEDIATE;")
        # On a derived-schema upgrade (e.g. the relations/observations tables added
        # at v2), clear the incremental bookkeeping so every note is reprocessed and
        # the new tables are backfilled in this same pass — no note can stay stale.
        if schema_version(conn) != SCHEMA_VERSION:
            conn.execute("DELETE FROM indexed_files;")
            conn.execute("DELETE FROM relations;")
            conn.execute("DELETE FROM observations;")
            set_schema_version(conn)
        files = _iter_markdown_files(vault)
        disk_paths: set[str] = set()
        meta: dict[str, tuple[int, int]] = {}

        for fp in files:
            stats.scanned += 1
            rel = _rel_posix(vault, fp)
            disk_paths.add(rel)
            key = _stat_key(fp)
            if key is None:
                continue
            mtime_ns, size_b = key
            meta[rel] = (mtime_ns, size_b)

        cur = conn.execute("SELECT path, mtime_ns, size_bytes FROM indexed_files")
        db_indexed = {str(r["path"]): (int(r["mtime_ns"]), int(r["size_bytes"])) for r in cur.fetchall()}

        for path_str in set(db_indexed) - disk_paths:
            conn.execute("DELETE FROM vault_fts WHERE path = ?", (path_str,))
            conn.execute("DELETE FROM indexed_files WHERE path = ?", (path_str,))
            conn.execute("DELETE FROM relations WHERE source_path = ?", (path_str,))
            conn.execute("DELETE FROM observations WHERE source_path = ?", (path_str,))
            stats.removed += 1

        cur = conn.execute("SELECT path, mtime_ns, size_bytes FROM indexed_files")
        db_indexed = {str(r["path"]): (int(r["mtime_ns"]), int(r["size_bytes"])) for r in cur.fetchall()}

        pending = 0
        for rel, (mtime_ns, size_b) in meta.items():
            prev = db_indexed.get(rel)
            if prev == (mtime_ns, size_b):
                stats.skipped_unchanged += 1
                continue

            fp = vault / Path(rel)
            try:
                st_size = fp.stat().st_size
            except OSError:
                continue
            if st_size > max_file_bytes:
                stats.truncated += 1
            title, body = read_note(fp, max_file_bytes)

            conn.execute("DELETE FROM vault_fts WHERE path = ?", (rel,))
            conn.execute(
                "INSERT INTO vault_fts(path, mtime_ns, title, body) VALUES (?, ?, ?, ?)",
                (rel, mtime_ns, title, body),
            )
            conn.execute(
                """INSERT INTO indexed_files(path, mtime_ns, size_bytes) VALUES (?, ?, ?)
                   ON CONFLICT(path) DO UPDATE SET mtime_ns=excluded.mtime_ns, size_bytes=excluded.size_bytes""",
                (rel, mtime_ns, size_b),
            )

            # Knowledge graph: parse this note's typed/untyped relations and
            # structured observations from the text already in hand (no extra read)
            # and rebuild its rows. Relations scan title+body so the edge set matches
            # graphlink exactly; observations are list items, so the body suffices.
            stats.relations += _index_note_kg(conn, rel, title, body)
            stats.observations += _index_note_observations(conn, rel, body)

            if prev is None:
                stats.inserted += 1
            else:
                stats.updated += 1

            pending += 1
            if pending >= batch_commit_every:
                conn.execute("COMMIT;")
                conn.execute("BEGIN IMMEDIATE;")
                pending = 0

        conn.execute("COMMIT;")
    finally:
        conn.close()
    return stats


@dataclass
class FreshStats:
    """What :func:`ensure_fresh` refreshed before a query ran."""

    fts: IndexStats
    vectors: VectorStats | None = None  # None => semantic refresh was skipped
    # The embedder identity actually used when vectors is not None — callers that
    # need to filter/query note_chunks by embedder (report.py/reflect.py's
    # duplicate scan, hybrid-search's query embedding) should use THIS instead of
    # independently re-deriving via resolve_embedder_name(None): this is the
    # identity ensure_fresh's own on-disk-preference logic actually settled on,
    # which can differ from the env/default when no explicit --embedder was given.
    embedder_name: str | None = None


def _vault_has_vectors(vault: Path) -> bool:
    """True if a vector index already exists for this vault (note_chunks non-empty).

    Cheap and safe to call on a never-indexed vault: it just opens the sidecar DB
    (creating the dir) and probes the chunk table, which is created on demand.
    """
    conn = connect(index_db_path(vault.resolve()))
    try:
        return has_any_chunks(conn)
    finally:
        conn.close()


def ensure_fresh(
    vault: Path,
    *,
    semantic: bool = False,
    embedder: "Embedder | None" = None,
    max_file_bytes: int = 1_048_576,
) -> FreshStats:
    """Refresh the index just before a search so recent edits are visible (D8).

    Always runs the incremental :func:`index_vault` — it is cheap because unchanged
    files are skipped by ``(mtime_ns, size)``. The semantic vectors are refreshed
    via :func:`index_vectors` **only if** they already exist for this vault, or the
    caller explicitly asks with ``semantic=True``; this preserves the zero-dependency
    default so a user who never opted into embeddings is never forced to build them.

    When the caller passes no explicit ``embedder`` and a vector index already
    exists on disk, the embedder identity that actually built it is reused in
    preference to the env/default resolution (:func:`embeddings.get_embedder`
    with no override). Without this, most CLI subcommands call ``ensure_fresh``
    bare — if the vault's index was built once with ``--embedder fastembed:...``
    but ``OBSIDIAN_MEMORY_EMBEDDER`` was never exported, every later bare call
    would silently resolve back to the ``hashing`` default and start building a
    second, redundant vector index beside the real one with no warning. An
    explicit ``embedder=`` argument always wins outright — this reuse only
    engages for the "caller didn't say" case.
    """
    vault = vault.resolve()
    fts = index_vault(vault, max_file_bytes=max_file_bytes)

    vectors: VectorStats | None = None
    embedder_name: str | None = None
    if semantic or _vault_has_vectors(vault):
        if embedder is None:
            # Lazy import: keeps embeddings out of the dependency-free FTS path.
            from .embeddings import embedder_for_identity, get_embedder, resolve_embedder_name

            default_name = resolve_embedder_name(None)
            existing_name = _existing_vector_embedder_name(vault)
            embedder = None
            if existing_name is not None and existing_name != default_name:
                embedder = embedder_for_identity(existing_name)
            if embedder is None:
                embedder = get_embedder(None)
        vectors = index_vectors(vault, embedder, max_file_bytes=max_file_bytes)
        embedder_name = embedder.name

    return FreshStats(fts=fts, vectors=vectors, embedder_name=embedder_name)


def _existing_vector_embedder_name(vault: Path) -> str | None:
    """The dominant embedder identity already stored in this vault's index, if any."""
    conn = connect(index_db_path(vault))
    try:
        return dominant_embedder_name(conn)
    finally:
        conn.close()


@dataclass
class VectorStats:
    scanned: int = 0
    embedded: int = 0  # notes (re)embedded
    skipped_unchanged: int = 0
    removed: int = 0
    chunks: int = 0  # chunk rows written across all embedded notes


def index_vectors(
    vault: Path,
    embedder: "Embedder",
    *,
    max_file_bytes: int = 1_048_576,
    batch_commit_every: int = 64,
) -> VectorStats:
    """Build or refresh note-chunk embeddings beside the FTS index.

    Each note is split into heading-aware chunks (see :mod:`.chunking`) and every
    chunk is embedded, so search can return the relevant passage instead of the
    whole note. Idempotent and incremental by ``(path, mtime_ns)`` for the given
    embedder: a changed note has all its chunks rebuilt and deleted notes are
    pruned. ``stats.embedded`` counts notes (re)embedded, ``stats.chunks`` the rows
    written. Kept separate from :func:`index_vault` so the dependency-free FTS path
    is never affected by enabling semantics.
    """
    vault = vault.resolve()
    db_path = index_db_path(vault)
    stats = VectorStats()
    conn = connect(db_path)
    try:
        init_chunks(conn)
        conn.execute("BEGIN IMMEDIATE;")
        disk_meta: dict[str, int] = {}
        for fp in _iter_markdown_files(vault):
            stats.scanned += 1
            rel = _rel_posix(vault, fp)
            key = _stat_key(fp)
            if key is not None:
                disk_meta[rel] = key[0]

        have = current_chunk_keys(conn, embedder.name)
        for path_str in set(have) - set(disk_meta):
            delete_chunks_for_path(conn, path_str, embedder.name)
            stats.removed += 1

        pending = 0
        for rel, mtime_ns in disk_meta.items():
            if have.get(rel) == mtime_ns:
                stats.skipped_unchanged += 1
                continue
            title, body = read_note(vault / Path(rel), max_file_bytes)
            chunks = split_into_chunks(title, body)
            if not chunks:
                continue
            texts = [f"{c.heading}\n{c.text}" if c.heading else c.text for c in chunks]
            vecs = embedder.embed(texts)
            delete_chunks_for_path(conn, rel, embedder.name)
            for c, vec in zip(chunks, vecs):
                upsert_chunk(
                    conn, rel, c.ordinal, mtime_ns, embedder.name, c.heading, c.text, vec
                )
            stats.embedded += 1
            stats.chunks += len(chunks)
            pending += 1
            if pending >= batch_commit_every:
                conn.execute("COMMIT;")
                conn.execute("BEGIN IMMEDIATE;")
                pending = 0

        conn.execute("COMMIT;")
    finally:
        conn.close()
    return stats

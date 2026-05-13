"""Incremental FTS5 indexer for Markdown vaults."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .markdown_io import read_note
from .paths import index_db_path
from .store import connect, init_schema


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
            truncated = False
            try:
                st_size = fp.stat().st_size
            except OSError:
                continue
            if st_size > max_file_bytes:
                truncated = True
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
            if prev is None:
                stats.inserted += 1
            else:
                stats.updated += 1
            if truncated:
                pass

            pending += 1
            if pending >= batch_commit_every:
                conn.execute("COMMIT;")
                conn.execute("BEGIN IMMEDIATE;")
                pending = 0

        conn.execute("COMMIT;")
    finally:
        conn.close()
    return stats

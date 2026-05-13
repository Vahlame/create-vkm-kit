"""SQLite + FTS5 schema and connection helpers."""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
  path UNINDEXED,
  mtime_ns UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS indexed_files(
  path TEXT PRIMARY KEY,
  mtime_ns INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL
);
"""


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, isolation_level=None)
    conn.row_factory = sqlite3.Row
    # WAL + mmap improve read-heavy agent workloads on large vaults.
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute("PRAGMA mmap_size=268435456;")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)

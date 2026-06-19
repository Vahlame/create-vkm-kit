"""SQLite + FTS5 schema and connection helpers."""

from __future__ import annotations

import sqlite3
from pathlib import Path

# Bump whenever a *derived* table's shape or how it is populated changes, so the
# indexer knows to rebuild it. The knowledge-graph tables (relations/observations)
# were added at version 2: the incremental indexer only touches changed notes, so a
# newly added table would otherwise stay empty for every unchanged note (the exact
# "backfill" problem ADR-0019 cited when deferring a persisted edge table). Tying
# the tables to a version that forces one full reindex on upgrade solves it cleanly.
SCHEMA_VERSION = 2

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

CREATE TABLE IF NOT EXISTS schema_meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Typed directed edges parsed from each note (knowledge_graph.parse_relations).
-- `target` is the normalized wikilink key, resolved to a real path at query time
-- (never stored) so the table is a pure function of each note's own content — no
-- cross-note write-time dependency, hence no staleness when a sibling note appears.
CREATE TABLE IF NOT EXISTS relations(
  source_path   TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  target        TEXT NOT NULL,
  context       TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (source_path, relation_type, target)
);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target);
CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relation_type);

-- Structured observations (knowledge_graph.parse_observations); `tags` is the
-- space-joined normalized tag set, matched exactly via a sentinel-padded LIKE.
CREATE TABLE IF NOT EXISTS observations(
  source_path TEXT NOT NULL,
  ordinal     INTEGER NOT NULL,
  category    TEXT NOT NULL,
  content     TEXT NOT NULL,
  tags        TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (source_path, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_observations_category ON observations(category);
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


def schema_version(conn: sqlite3.Connection) -> int:
    """Stored derived-schema version (0 if never set / pre-versioning)."""
    row = conn.execute("SELECT value FROM schema_meta WHERE key = 'version'").fetchone()
    return int(row["value"]) if row else 0


def set_schema_version(conn: sqlite3.Connection, version: int = SCHEMA_VERSION) -> None:
    """Record the derived-schema version (call after a rebuild)."""
    conn.execute(
        "INSERT INTO schema_meta(key, value) VALUES ('version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (str(version),),
    )

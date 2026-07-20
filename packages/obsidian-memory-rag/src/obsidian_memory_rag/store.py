"""SQLite + FTS5 schema and connection helpers."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

# Budget for a lock-taking connection-setup step. Used twice, deliberately: as
# `PRAGMA busy_timeout` (sqlite's own blocking retry, which covers ordinary
# statements) and as the ceiling for the manual WAL-transition retry below,
# which that handler does NOT cover. Bounded, not indefinite: a genuinely stuck
# writer still surfaces OperationalError instead of hanging forever.
BUSY_TIMEOUT_MS = 30_000

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

-- Recall telemetry (ADR-0038): which notes searches RETURNED and which the agent
-- then actually USED (opened). NOT a derived table — it cannot be rebuilt from
-- the markdown, so it must never join the schema-version DELETE block in
-- indexer.py; reindexes leave it untouched. Feeds the opt-in `usage` ranking
-- boost and the cold-notes decay report.
CREATE TABLE IF NOT EXISTS recall_log(
  path       TEXT NOT NULL,
  event      TEXT NOT NULL CHECK(event IN ('returned', 'used')),
  query_hash TEXT NOT NULL DEFAULT '',
  at_ns      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recall_log_path ON recall_log(path, event, at_ns);
"""


def _enable_wal(conn: sqlite3.Connection) -> None:
    """Switch the database to WAL, retrying while a competing writer blocks it.

    Why this cannot just be ``conn.execute("PRAGMA journal_mode=WAL;")``:
    converting a database *into* WAL needs a brief EXCLUSIVE lock, and sqlite
    takes it on a code path (``pagerExclusiveLock``) that does NOT consult the
    busy handler. So ``PRAGMA busy_timeout`` — however large, and even when set
    first — does not apply to this one statement: a contended transition fails
    *instantly* with "database is locked". Measured, not assumed: with
    busy_timeout=3000 already set, a transition contended by an open write
    transaction raises in 0.000s, while the same pragma against an
    already-WAL database returns 'wal' in 0.008s taking no lock at all.

    That second measurement is what makes a plain retry the right fix rather
    than a band-aid: the *only* way to lose this race is for another connection
    to be converting the same database, and once any one of them wins, every
    subsequent attempt is a lock-free no-op. So the loop converges as soon as
    the winner commits, instead of spinning for the full budget.

    The trigger in practice is a cold vault, not an exotic edge case:
    ``assembleContext`` fans out three rag processes over one vault at once, so
    the first query against a fresh index has three processes creating the same
    database concurrently.

    A non-lock failure is re-raised immediately. So is a lock failure past the
    budget — with the original error, which is the useful diagnostic. A database
    that simply cannot do WAL (some network filesystems) reports the old mode as
    the pragma's *result* rather than raising, and is left alone exactly as
    before: this function only ever retries a genuine lock.
    """
    deadline = time.monotonic() + BUSY_TIMEOUT_MS / 1000
    delay = 0.005
    while True:
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
            return
        except sqlite3.OperationalError as exc:
            # "database is locked" (SQLITE_BUSY) / "database table is locked"
            # (SQLITE_LOCKED). Anything else is not contention — fail loudly.
            if "locked" not in str(exc).lower():
                raise
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise
            time.sleep(min(delay, remaining))
            delay = min(delay * 2, 0.1)


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, isolation_level=None)
    try:
        conn.row_factory = sqlite3.Row
        # FIRST, before any statement that can take a lock: two concurrent
        # ensure_fresh() calls (e.g. two overlapping MCP requests) each open their
        # own connection and take a writer lock via BEGIN IMMEDIATE
        # (index_vault/index_vectors). Without this, sqlite3.connect()'s own
        # implicit ~5s busy wait is the only thing standing between a second
        # writer and an instant "database is locked" — and it is silently too
        # short once a single commit batch (batch_commit_every notes, each
        # re-embedded) legitimately holds the lock longer, e.g. under a real
        # (non-hashing) embedder. Make the wait explicit and generous instead of
        # relying on that undocumented default; sqlite's busy handler then
        # blocks-and-retries BEGIN IMMEDIATE transparently, so no manual retry
        # loop is needed for *those* (verified — tests/test_concurrent_ensure_fresh.py).
        conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS};")
        # WAL + mmap improve read-heavy agent workloads on large vaults. WAL needs
        # its own retry: the busy handler above does not cover the transition.
        _enable_wal(conn)
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA temp_store=MEMORY;")
        conn.execute("PRAGMA mmap_size=268435456;")
    except BaseException:
        # Never leak the handle (and its locks) when setup fails partway.
        conn.close()
        raise
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

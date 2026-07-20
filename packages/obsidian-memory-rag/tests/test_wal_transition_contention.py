"""Regression test: opening a *cold* index concurrently must not crash.

Root cause (pre-fix): ``store.connect()`` ran ``PRAGMA journal_mode=WAL`` while
another connection held the write lock on a database still in ``delete`` journal
mode. Converting a database into WAL needs a brief EXCLUSIVE lock, taken on a
sqlite code path that never consults the busy handler — so ``PRAGMA
busy_timeout`` does not apply to it, however large, and even when set first. The
loser raised ``sqlite3.OperationalError: database is locked`` *instantly*
(measured: 0.000s with busy_timeout=3000 already in effect).

This is not a synthetic race. ``assembleContext`` fans out three rag processes
over one vault at once, so the very first query against a fresh vault has three
processes creating the same database concurrently — which is exactly how it
surfaced, as a flaky ``vkm-spec`` pipeline test in CI.

Distinct from test_concurrent_ensure_fresh.py: that one covers ``BEGIN
IMMEDIATE`` contention on an *already-WAL* database, which the busy handler
*does* cover. This one covers the transition itself, which it does not.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path

import pytest

from obsidian_memory_rag.store import connect

# Deliberately NOT imported from store: a regression test that only *collects*
# against the fixed module could never have caught the bug it guards.
JOIN_TIMEOUT_S = 35.0


def _journal_mode(db: Path) -> str:
    probe = sqlite3.connect(db, isolation_level=None)
    try:
        return str(probe.execute("PRAGMA journal_mode;").fetchone()[0]).lower()
    finally:
        probe.close()


def test_connect_waits_out_a_contended_wal_transition(tmp_path: Path) -> None:
    db = tmp_path / "sidecar" / "fts.sqlite"
    db.parent.mkdir(parents=True)

    # A cold database in the default `delete` journal mode, with a writer holding
    # the lock — so connect() must genuinely *transition* into WAL, contended.
    holder = sqlite3.connect(db, isolation_level=None)
    holder.execute("CREATE TABLE t(x)")
    assert _journal_mode(db) != "wal", "precondition: a transition must be required"
    holder.execute("BEGIN IMMEDIATE")
    holder.execute("INSERT INTO t VALUES (1)")

    result: dict[str, object] = {}

    def opener() -> None:
        try:
            conn = connect(db)
            try:
                result["mode"] = str(
                    conn.execute("PRAGMA journal_mode;").fetchone()[0]
                ).lower()
            finally:
                conn.close()
        except BaseException as exc:  # captured, asserted below
            result["error"] = exc

    t = threading.Thread(target=opener)
    t.start()
    # Hold the lock long enough that a non-retrying connect() has certainly
    # already failed (pre-fix it raised in ~0s), then let the transition through.
    time.sleep(0.5)
    holder.execute("ROLLBACK")
    holder.close()

    t.join(timeout=JOIN_TIMEOUT_S)
    assert not t.is_alive(), "connect() never returned — the retry is not bounded"
    assert "error" not in result, f"connect() raised under WAL contention: {result['error']!r}"
    assert result["mode"] == "wal", f"expected WAL after the retry, got {result['mode']!r}"


def test_connect_gives_up_and_reports_a_non_lock_failure_immediately(tmp_path: Path) -> None:
    """The retry loop must not swallow real errors or turn them into a 30s hang."""
    not_a_db = tmp_path / "sidecar" / "fts.sqlite"
    not_a_db.parent.mkdir(parents=True)
    not_a_db.write_bytes(b"this is definitely not a sqlite database" * 8)

    started = time.monotonic()
    with pytest.raises(sqlite3.DatabaseError):
        connect(not_a_db)
    assert time.monotonic() - started < 5, "a non-lock failure must not be retried"

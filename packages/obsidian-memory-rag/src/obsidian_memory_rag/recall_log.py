"""Recall telemetry: returned/used events per note (ADR-0038).

Two implicit-feedback events, logged by the CLI on behalf of the Node sidecar
(Node stays sqlite-free):

- ``returned`` — a search surfaced the note (one row per hit, ``--log-recall``).
- ``used`` — the agent then opened the note (``json-log-use``, fired
  fire-and-forget from ``vault_read_file``).

``search returned it AND the agent opened it`` is the cheap, deterministic
signal that a memory actually helped. :func:`usage_counts` feeds the opt-in
``usage`` ranking boost; zero-event notes feed the cold-notes decay report.
The table is telemetry, not derived state — reindexes never touch it, and a
lost/deleted DB only loses history, never memory (markdown stays truth).

Every write is best-effort: telemetry must never break a search or a read, so
callers treat failures as no-ops.
"""

from __future__ import annotations

import hashlib
import time
from pathlib import Path

from .paths import index_db_path
from .store import connect, init_schema

_NS_PER_DAY = 86_400 * 1_000_000_000

# Keep the log bounded without a daemon: on each write pass, drop events older
# than a year (far beyond any boost window).
_PRUNE_AFTER_DAYS = 365


def _query_hash(query: str) -> str:
    return hashlib.sha256(query.encode("utf-8")).hexdigest()[:12]


def log_events(vault: Path, event: str, paths: list[str], *, query: str = "") -> int:
    """Insert one ``event`` row per path (single transaction). Returns rows written.

    Best-effort by contract: any sqlite failure returns 0 instead of raising.
    """
    if event not in ("returned", "used") or not paths:
        return 0
    db_path = index_db_path(vault.resolve())
    if not db_path.parent.is_dir() and event == "used":
        # No sidecar dir yet — nothing to log against; creating the DB just to
        # record a read would be noise.
        return 0
    try:
        conn = connect(db_path)
        try:
            init_schema(conn)
            now = time.time_ns()
            qh = _query_hash(query) if query else ""
            conn.execute("BEGIN IMMEDIATE;")
            conn.executemany(
                "INSERT INTO recall_log(path, event, query_hash, at_ns) VALUES (?, ?, ?, ?)",
                [(p, event, qh, now) for p in paths],
            )
            conn.execute(
                "DELETE FROM recall_log WHERE at_ns < ?",
                (now - _PRUNE_AFTER_DAYS * _NS_PER_DAY,),
            )
            conn.execute("COMMIT;")
            return len(paths)
        finally:
            conn.close()
    except Exception:
        return 0


def usage_counts(vault: Path, paths: list[str], *, window_days: float = 90.0) -> dict[str, int]:
    """``path -> count of 'used' events`` within the window, for the given paths.

    Zeros (and an all-zero dict on any failure) so the ranking lever degrades to
    a no-op — usage can only promote among candidates, never break a search.
    """
    out = {p: 0 for p in paths}
    if not paths:
        return out
    db_path = index_db_path(vault.resolve())
    if not db_path.is_file():
        return out
    try:
        conn = connect(db_path)
        try:
            init_schema(conn)
            cutoff = time.time_ns() - int(window_days * _NS_PER_DAY)
            placeholders = ",".join("?" * len(paths))
            rows = conn.execute(
                f"SELECT path, COUNT(*) AS n FROM recall_log "
                f"WHERE event = 'used' AND at_ns >= ? AND path IN ({placeholders}) "
                f"GROUP BY path",
                [cutoff, *paths],
            ).fetchall()
        finally:
            conn.close()
    except Exception:
        return out
    for r in rows:
        out[str(r["path"])] = int(r["n"])
    return out


def usage_counts_decayed(
    vault: Path, paths: list[str], *, window_days: float = 90.0
) -> dict[str, float]:
    """Recency-weighted ``path -> effective 'used' count`` within the window.

    :func:`usage_counts` is a flat count: every event inside ``window_days`` is
    worth exactly 1, so a note used heavily near the *start* of the window (stale
    but technically still in-window) keeps full credit right up to the moment it
    ages out — a step function, not a taper. This variant weights each event by
    its own recency instead: linear decay from 1.0 at age 0 down to 0.0 at
    ``window_days`` old (``max(0.0, 1.0 - age_days / window_days)``). The usage
    ranking boost (see ``query.py``) feeds the sum into its ``log1p`` multiplier
    so an old note's boost genuinely fades once it stops being touched, rather
    than only fading when the whole window finally rolls past it — this is what
    lets a brand-new, equally-relevant note compete instead of losing every tie
    to stale-but-in-window usage credit (ADR-0038's recency-of-memory intent).

    Same zero-on-empty / no-op-on-failure contract as :func:`usage_counts`.
    """
    out: dict[str, float] = {p: 0.0 for p in paths}
    if not paths:
        return out
    db_path = index_db_path(vault.resolve())
    if not db_path.is_file():
        return out
    try:
        conn = connect(db_path)
        try:
            init_schema(conn)
            now_ns = time.time_ns()
            cutoff = now_ns - int(window_days * _NS_PER_DAY)
            placeholders = ",".join("?" * len(paths))
            rows = conn.execute(
                f"SELECT path, at_ns FROM recall_log "
                f"WHERE event = 'used' AND at_ns >= ? AND path IN ({placeholders})",
                [cutoff, *paths],
            ).fetchall()
        finally:
            conn.close()
    except Exception:
        return out
    for r in rows:
        age_days = max(0.0, (now_ns - int(r["at_ns"])) / _NS_PER_DAY)
        weight = max(0.0, 1.0 - (age_days / window_days)) if window_days > 0 else 1.0
        path = str(r["path"])
        out[path] = out.get(path, 0.0) + weight
    return out


def cold_notes(
    vault: Path, *, min_indexed_days: float = 30.0, limit: int = 20
) -> list[dict]:
    """Notes indexed for a while that NO search returned and NO read touched.

    The decay side of the loop: memory that never helps is a compaction/archive
    candidate for the human to review (never auto-deleted). Empty list without a
    DB or when telemetry is missing entirely (a vault with no recall_log rows at
    all yields [], not "everything is cold" — no usage data is not evidence of
    disuse).
    """
    db_path = index_db_path(vault.resolve())
    if not db_path.is_file():
        return []
    try:
        conn = connect(db_path)
        try:
            init_schema(conn)
            any_row = conn.execute("SELECT 1 FROM recall_log LIMIT 1").fetchone()
            if not any_row:
                return []
            now = time.time_ns()
            cutoff = now - int(min_indexed_days * _NS_PER_DAY)
            rows = conn.execute(
                "SELECT f.path, f.mtime_ns FROM vault_fts AS f "
                "WHERE f.mtime_ns < ? AND NOT EXISTS "
                "(SELECT 1 FROM recall_log r WHERE r.path = f.path) "
                "ORDER BY f.mtime_ns ASC",
                (cutoff,),
            ).fetchall()
        finally:
            conn.close()
    except Exception:
        return []
    return [
        {
            "path": str(r["path"]),
            "age_days": round((now - int(r["mtime_ns"])) / _NS_PER_DAY, 1),
        }
        for r in rows[:limit]
    ]

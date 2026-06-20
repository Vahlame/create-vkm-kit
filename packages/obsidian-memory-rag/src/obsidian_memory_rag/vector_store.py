"""Persisted note-chunk vectors + brute-force cosine search.

Notes are split into heading-aware chunks (see ``chunking.py``) and each chunk is
embedded separately. This sharpens retrieval — a query matches a specific section
instead of a whole multi-topic note — and, crucially, lets search return just the
relevant passage so the agent rarely needs to read the full note. That passage-
level return is the main token saver of the hybrid memory.

Chunks live in a ``note_chunks`` table inside ``fts.sqlite``; search is brute-
force cosine in Python (sub-10 ms for a personal vault, dependency-free; the
interface still leaves room for ``sqlite-vec`` at large scale — see ADR-0017).
Vectors are stored L2-normalized, so cosine similarity is a plain dot product.
Rows carry the ``embedder`` name + ``dim`` so chunks built by one model are never
compared against a query embedded by another.
"""

from __future__ import annotations

import heapq
import math
import os
import sqlite3
from array import array
from dataclasses import dataclass

CHUNK_SCHEMA = """
CREATE TABLE IF NOT EXISTS note_chunks(
  path TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  mtime_ns INTEGER NOT NULL,
  embedder TEXT NOT NULL,
  dim INTEGER NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  vec BLOB NOT NULL,
  PRIMARY KEY (path, ordinal, embedder)
);
"""


@dataclass
class ChunkHit:
    path: str
    ordinal: int
    heading: str
    text: str
    score: float  # cosine similarity in [-1, 1]


def init_chunks(conn: sqlite3.Connection) -> None:
    # One statement on purpose: execute() (unlike executescript()) does NOT
    # implicitly COMMIT, so this stays safe to call inside an open BEGIN/COMMIT
    # batch — e.g. current_chunk_keys() called mid-transaction by index_vectors.
    conn.execute(CHUNK_SCHEMA)


def _to_blob(vec: array) -> bytes:
    return vec.tobytes()


def _from_blob(blob: bytes) -> array:
    out = array("f")
    out.frombytes(blob)
    return out


def upsert_chunk(
    conn: sqlite3.Connection,
    path: str,
    ordinal: int,
    mtime_ns: int,
    embedder: str,
    heading: str,
    text: str,
    vec: array,
) -> None:
    conn.execute(
        """INSERT INTO note_chunks(path, ordinal, mtime_ns, embedder, dim, heading, text, vec)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(path, ordinal, embedder) DO UPDATE SET
             mtime_ns=excluded.mtime_ns, dim=excluded.dim, heading=excluded.heading,
             text=excluded.text, vec=excluded.vec""",
        (path, ordinal, mtime_ns, embedder, len(vec), heading, text, _to_blob(vec)),
    )


def delete_chunks_for_path(
    conn: sqlite3.Connection, path: str, embedder: str | None = None
) -> None:
    if embedder is None:
        conn.execute("DELETE FROM note_chunks WHERE path = ?", (path,))
    else:
        conn.execute(
            "DELETE FROM note_chunks WHERE path = ? AND embedder = ?", (path, embedder)
        )


def has_any_chunks(conn: sqlite3.Connection) -> bool:
    """True if the ``note_chunks`` table holds at least one row (any embedder).

    Used to decide whether a vault has ever opted into semantic vectors, so the
    auto-refresh can keep them current without forcing an embedding build on a
    user who never enabled them.
    """
    init_chunks(conn)
    row = conn.execute("SELECT 1 FROM note_chunks LIMIT 1").fetchone()
    return row is not None


def current_chunk_keys(conn: sqlite3.Connection, embedder: str) -> dict[str, int]:
    """Map ``path -> mtime_ns`` for notes already chunked by ``embedder``.

    All chunks of a note share its mtime, so any row per path answers "is this
    note's embedding current?" for the incremental skip in ``index_vectors``.
    """
    init_chunks(conn)
    cur = conn.execute(
        "SELECT path, mtime_ns FROM note_chunks WHERE embedder = ?", (embedder,)
    )
    return {str(r["path"]): int(r["mtime_ns"]) for r in cur.fetchall()}


# Opt-in embedded-vector acceleration via sqlite-vec (ADR-0025). Off unless the
# user installs the [vec] extra AND sets OBSIDIAN_MEMORY_SQLITE_VEC to a truthy
# value, so the default retrieval path is byte-for-byte the pure-Python brute force
# (deterministic, dependency-free, what the bench measures). When on, the cosine
# scan runs inside SQLite — same exact ranking (vectors are L2-normalized, so
# ascending cosine *distance* == descending similarity), just in C, which is what
# pays off on a large vault. It is an acceleration, not an approximation.
def _sqlite_vec_enabled() -> bool:
    return os.environ.get("OBSIDIAN_MEMORY_SQLITE_VEC", "").strip().lower() in (
        "1",
        "true",
        "on",
        "yes",
    )


def _load_sqlite_vec(conn: sqlite3.Connection) -> bool:
    """Load the sqlite-vec extension on ``conn``; return True on success.

    Tolerant by design: a missing package or a Python built without
    ``enable_load_extension`` simply yields False and the caller falls back to the
    pure-Python path — so enabling the flag can never break search, only speed it.
    """
    try:
        import sqlite_vec  # type: ignore

        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        return True
    except Exception:
        return False


def _search_chunks_sqlite_vec(
    conn: sqlite3.Connection, query_vec: array, embedder: str, limit: int
) -> list[ChunkHit]:
    """Top-``limit`` chunks by cosine, computed by sqlite-vec inside SQLite.

    The ``length(vec) = ?`` guard keeps ``vec_distance_cosine`` from ever seeing a
    dimension-mismatched row (which would abort the query), mirroring the
    brute-force path's ``len(vec) != len(query_vec)`` skip.
    """
    qblob = query_vec.tobytes()
    rows = conn.execute(
        "SELECT path, ordinal, heading, text, "
        "vec_distance_cosine(vec, ?) AS dist FROM note_chunks "
        "WHERE embedder = ? AND length(vec) = ? "
        "ORDER BY dist ASC LIMIT ?",
        (qblob, embedder, len(query_vec) * 4, limit),
    ).fetchall()
    return [
        ChunkHit(
            str(r["path"]),
            int(r["ordinal"]),
            str(r["heading"] or ""),
            str(r["text"] or ""),
            1.0 - float(r["dist"]),  # cosine similarity from distance (normalized vecs)
        )
        for r in rows
    ]


def fetch_chunk_vecs(
    conn: sqlite3.Connection, items: list[tuple[str, int]], embedder: str
) -> dict[str, array]:
    """Return ``{path: vec}`` for the given ``(path, ordinal)`` chunk keys.

    Used by MMR diversification (query.py) to measure candidate-to-candidate
    similarity over the *same* L2-normalized vectors retrieval already ranked on
    (cosine == dot). A missing chunk is simply omitted; the caller treats a note
    without a vector as maximally novel.
    """
    init_chunks(conn)
    out: dict[str, array] = {}
    for path, ordinal in items:
        row = conn.execute(
            "SELECT vec FROM note_chunks WHERE path = ? AND ordinal = ? AND embedder = ?",
            (path, ordinal, embedder),
        ).fetchone()
        if row is not None:
            out[path] = _from_blob(row["vec"])
    return out


def fetch_adjacent_chunks(
    conn: sqlite3.Connection, path: str, ordinal: int, window: int, embedder: str
) -> list[tuple[int, str, str]]:
    """Return ``(ordinal, heading, text)`` for chunks of ``path`` within ``window``.

    Pulls ordinals ``[ordinal-window, ordinal+window]`` that exist, in order, so the
    caller can present a richer contiguous passage (the agent answers from a complete
    section, not a clipped slice) without a full-note read. Ranking is unaffected —
    this only widens the returned snippet. ``window <= 0`` returns just the chunk.
    """
    init_chunks(conn)
    lo, hi = ordinal - max(0, window), ordinal + max(0, window)
    rows = conn.execute(
        "SELECT ordinal, heading, text FROM note_chunks "
        "WHERE path = ? AND embedder = ? AND ordinal BETWEEN ? AND ? ORDER BY ordinal",
        (path, embedder, lo, hi),
    ).fetchall()
    return [(int(r["ordinal"]), str(r["heading"] or ""), str(r["text"] or "")) for r in rows]


def search_chunks(
    conn: sqlite3.Connection, query_vec: array, embedder: str, limit: int
) -> list[ChunkHit]:
    """Cosine search over all chunks built by ``embedder``, best first.

    Default path is pure-Python brute force: only the top ``limit`` are kept via a
    bounded heap (``heapq.nlargest`` is O(n·log k) — it never fully sorts the n
    candidates). With ``OBSIDIAN_MEMORY_SQLITE_VEC`` enabled and the sqlite-vec
    extension loadable, the identical cosine ranking is computed inside SQLite
    instead (faster at scale); any failure falls back transparently to brute force.
    """
    init_chunks(conn)
    if _sqlite_vec_enabled() and _load_sqlite_vec(conn):
        try:
            return _search_chunks_sqlite_vec(conn, query_vec, embedder, limit)
        except sqlite3.Error:
            pass  # extension misbehaved — fall back to the always-correct brute force
    cur = conn.execute(
        "SELECT path, ordinal, heading, text, vec FROM note_chunks WHERE embedder = ?",
        (embedder,),
    )
    hits: list[ChunkHit] = []
    for r in cur.fetchall():
        vec = _from_blob(r["vec"])
        if len(vec) != len(query_vec):
            continue
        score = math.fsum(x * y for x, y in zip(query_vec, vec))
        hits.append(
            ChunkHit(
                str(r["path"]),
                int(r["ordinal"]),
                str(r["heading"] or ""),
                str(r["text"] or ""),
                score,
            )
        )
    return heapq.nlargest(limit, hits, key=lambda h: h.score)

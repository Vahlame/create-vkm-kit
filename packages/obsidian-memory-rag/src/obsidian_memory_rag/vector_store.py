"""Persisted note vectors + brute-force cosine search.

Vectors live in the same SQLite file as the FTS index (``fts.sqlite``) in a
``note_vectors`` table. Search is brute-force cosine in Python: for a personal
vault (thousands of notes) a full scan is well under 10 ms, and it keeps the
default path dependency-free. The interface leaves room to swap in ``sqlite-vec``
for very large vaults without changing callers (see ADR-0017).

Vectors are stored already L2-normalized, so cosine similarity is a plain dot
product. Rows carry their ``embedder`` name + ``dim`` so vectors built by one
embedder are never compared against a query embedded by another.
"""

from __future__ import annotations

import math
import sqlite3
from array import array
from dataclasses import dataclass

VECTOR_SCHEMA = """
CREATE TABLE IF NOT EXISTS note_vectors(
  path TEXT PRIMARY KEY,
  mtime_ns INTEGER NOT NULL,
  embedder TEXT NOT NULL,
  dim INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  preview TEXT NOT NULL DEFAULT '',
  vec BLOB NOT NULL
);
"""


@dataclass
class VectorHit:
    path: str
    title: str
    preview: str
    score: float  # cosine similarity in [-1, 1]


def init_vectors(conn: sqlite3.Connection) -> None:
    # One statement on purpose: execute() (unlike executescript()) does NOT
    # implicitly COMMIT, so this stays safe to call inside an open BEGIN/COMMIT
    # batch — e.g. current_vector_keys() called mid-transaction by index_vectors.
    conn.execute(VECTOR_SCHEMA)


def _to_blob(vec: array) -> bytes:
    return vec.tobytes()


def _from_blob(blob: bytes) -> array:
    out = array("f")
    out.frombytes(blob)
    return out


def upsert_vector(
    conn: sqlite3.Connection,
    path: str,
    mtime_ns: int,
    embedder: str,
    title: str,
    preview: str,
    vec: array,
) -> None:
    conn.execute(
        """INSERT INTO note_vectors(path, mtime_ns, embedder, dim, title, preview, vec)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             mtime_ns=excluded.mtime_ns, embedder=excluded.embedder, dim=excluded.dim,
             title=excluded.title, preview=excluded.preview, vec=excluded.vec""",
        (path, mtime_ns, embedder, len(vec), title, preview, _to_blob(vec)),
    )


def delete_vector(conn: sqlite3.Connection, path: str) -> None:
    conn.execute("DELETE FROM note_vectors WHERE path = ?", (path,))


def current_vector_keys(conn: sqlite3.Connection, embedder: str) -> dict[str, int]:
    """Map ``path -> mtime_ns`` for vectors built by ``embedder`` (incremental skip)."""
    init_vectors(conn)
    cur = conn.execute(
        "SELECT path, mtime_ns FROM note_vectors WHERE embedder = ?", (embedder,)
    )
    return {str(r["path"]): int(r["mtime_ns"]) for r in cur.fetchall()}


def search_vectors(
    conn: sqlite3.Connection, query_vec: array, embedder: str, limit: int
) -> list[VectorHit]:
    """Brute-force cosine over all vectors built by ``embedder``, best first."""
    init_vectors(conn)
    cur = conn.execute(
        "SELECT path, title, preview, vec FROM note_vectors WHERE embedder = ?",
        (embedder,),
    )
    hits: list[VectorHit] = []
    for r in cur.fetchall():
        vec = _from_blob(r["vec"])
        if len(vec) != len(query_vec):
            continue
        score = math.fsum(x * y for x, y in zip(query_vec, vec))
        hits.append(
            VectorHit(str(r["path"]), str(r["title"] or ""), str(r["preview"] or ""), score)
        )
    hits.sort(key=lambda h: h.score, reverse=True)
    return hits[:limit]

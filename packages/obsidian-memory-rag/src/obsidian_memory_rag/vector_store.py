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

import math
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


def search_chunks(
    conn: sqlite3.Connection, query_vec: array, embedder: str, limit: int
) -> list[ChunkHit]:
    """Brute-force cosine over all chunks built by ``embedder``, best first."""
    init_chunks(conn)
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
    hits.sort(key=lambda h: h.score, reverse=True)
    return hits[:limit]

"""One-shot JSON export of the sidecar index for the Postgres projection layer.

The pg-service (Node) never parses Markdown itself: it shells out to
``json-dump-index`` and ingests this module's single-line JSON payload. The wire
shape is a frozen cross-agent contract — field names, the always-complete
``manifest``, and the changed-set semantics (``mtime_ns >= since`` unioned with
the explicit ``paths`` list) must not drift.

Both entry points are pure reads over ``fts.sqlite``: nothing here indexes,
embeds notes, or writes. The CLI handler refreshes first via
``ensure_fresh(semantic=False)``: the FTS index always, vectors ONLY when the
vault already has them — a dump never builds a first vector set implicitly.

Vector bytes cross the wire as base64 of float32 **little-endian** — the blobs
in ``note_chunks`` are ``array("f").tobytes()`` (native order), so they are
byteswapped first on a big-endian host.
"""

from __future__ import annotations

import base64
import sqlite3
import sys
from array import array
from collections.abc import Sequence
from pathlib import Path

from .embeddings import embedder_for_identity, get_embedder
from .paths import index_db_path
from .store import connect, init_schema
from .vector_store import dominant_embedder_name, has_any_chunks, init_chunks

# Bumped only when the dump payload's shape changes incompatibly; the consumer
# (pg-service) refuses payloads with a schema it does not understand.
DUMP_SCHEMA_VERSION = 1


def _f32le_b64(blob: bytes) -> str:
    """Base64 of ``blob`` reinterpreted as float32 little-endian bytes.

    Stored chunk vectors are native-endian (written by :func:`array.tobytes` on
    the same machine), so on the common little-endian hosts this is a straight
    encode; a big-endian host byteswaps a copy first so the wire stays LE.
    """
    if sys.byteorder == "big":  # pragma: no cover - no big-endian host in CI
        vec = array("f")
        vec.frombytes(blob)
        vec.byteswap()
        blob = vec.tobytes()
    return base64.b64encode(blob).decode("ascii")


def _first_segment(path: str) -> str:
    """First path segment of a nested note path, ``""`` for a vault-root note.

    Mirrors the consumer's ``folderOf`` (pg-sync.mjs) exactly — first segment,
    not dirname — so ``notes[].folder`` is byte-for-byte the value the
    projection stores in its ``notes.folder`` column.
    """
    i = path.find("/")
    return path[:i] if i > 0 else ""


def _open_index(vault: Path) -> sqlite3.Connection:
    """Connection to the vault's sidecar DB with every table guaranteed present.

    Creating the schema up front means a never-indexed vault yields an *empty*
    dump (valid payload, zero rows) instead of ``no such table`` — the consumer
    treats that the same as an empty vault.
    """
    conn = connect(index_db_path(Path(vault).resolve()))
    try:
        init_schema(conn)
        init_chunks(conn)
    except BaseException:
        conn.close()
        raise
    return conn


def dump_index(
    vault: Path,
    *,
    since_mtime_ns: int | None = None,
    include_vectors: bool = False,
    paths: Sequence[str] | None = None,
) -> dict:
    """The full ``json-dump-index`` payload as a plain dict (wire contract).

    - ``manifest`` ALWAYS lists every ``indexed_files`` row, so the consumer can
      diff deletions even on an incremental (``since_mtime_ns``) dump.
    - The changed set is the UNION of the two optional selectors: notes with
      ``mtime_ns >= since_mtime_ns`` (``>=`` not ``>`` — an edit landing exactly
      on the consumer's cursor is re-sent; re-sends are harmless upserts, silent
      drops are not) plus the explicit ``paths`` (always included regardless of
      the cursor — the consumer's targeted follow-up for notes its manifest diff
      flagged). With neither selector, every indexed note is in the set (full
      dump); with only ``paths``, the set is exactly those paths. ``notes``,
      ``chunks``, ``relations`` and ``observations`` all cover exactly that set.
    - ``chunks`` is restricted to the dominant embedder identity so a vault with
      leftover rows from an older embedder never ships mixed vector spaces; each
      chunk row carries its own ``mtime_ns`` (what the note looked like when it
      was embedded) so the consumer can detect stale chunks; ``vec_b64`` is
      attached only under ``include_vectors``.
    - Each note also carries ``folder`` (FIRST path segment, ``""`` at the
      root — the same value the consumer's ``folderOf`` computes for its
      ``notes.folder`` column) — additive beside the frozen wire fields.
    """
    conn = _open_index(vault)
    try:
        manifest = [
            [str(r["path"]), int(r["mtime_ns"])]
            for r in conn.execute(
                "SELECT path, mtime_ns FROM indexed_files ORDER BY path"
            ).fetchall()
        ]

        # Changed-set selection, pushed down into SQL (shared by every section
        # below via `changed_sql`) so an incremental dump never materializes
        # unchanged rows — or their vec BLOBs — in Python only to discard them.
        clauses: list[str] = []
        params: list[object] = []
        if since_mtime_ns is not None:
            clauses.append("f.mtime_ns >= ?")
            params.append(int(since_mtime_ns))
        if paths:
            placeholders = ", ".join("?" for _ in paths)
            clauses.append(f"f.path IN ({placeholders})")
            params.extend(str(p) for p in paths)
        where = f" WHERE {' OR '.join(clauses)}" if clauses else ""
        changed_sql = (
            "SELECT f.path FROM indexed_files f JOIN vault_fts v ON v.path = f.path" + where
        )

        note_sql = (
            "SELECT f.path AS path, f.mtime_ns AS mtime_ns, f.size_bytes AS size_b, "
            "v.title AS title, v.body AS body "
            "FROM indexed_files f JOIN vault_fts v ON v.path = f.path"
            f"{where} ORDER BY f.path"
        )
        notes = [
            {
                "path": str(r["path"]),
                "title": str(r["title"] or ""),
                "mtime_ns": int(r["mtime_ns"]),
                "size_b": int(r["size_b"]),
                "folder": _first_segment(str(r["path"])),
                "body": str(r["body"] or ""),
            }
            for r in conn.execute(note_sql, params)
        ]

        embedder = dominant_embedder_name(conn)
        dim: int | None = None
        chunks: list[dict] = []
        if embedder is not None:
            dim_row = conn.execute(
                "SELECT dim FROM note_chunks WHERE embedder = ? LIMIT 1", (embedder,)
            ).fetchone()
            dim = int(dim_row["dim"]) if dim_row is not None else None
            # Two query shapes on purpose: the vec BLOB is the heavy column, so
            # it is selected only when it will actually ship on the wire.
            cols = "c.path, c.ordinal, c.mtime_ns, c.heading, c.text"
            if include_vectors:
                cols += ", c.vec"
            for r in conn.execute(
                f"SELECT {cols} FROM note_chunks c "
                f"WHERE c.embedder = ? AND c.path IN ({changed_sql}) "
                "ORDER BY c.path, c.ordinal",
                (embedder, *params),
            ):
                row = {
                    "path": str(r["path"]),
                    "ordinal": int(r["ordinal"]),
                    "mtime_ns": int(r["mtime_ns"]),
                    "heading": str(r["heading"] or ""),
                    "text": str(r["text"] or ""),
                }
                if include_vectors:
                    row["vec_b64"] = _f32le_b64(r["vec"])
                chunks.append(row)

        relations = [
            {
                "source_path": str(r["source_path"]),
                "relation_type": str(r["relation_type"]),
                "target": str(r["target"]),
                "context": str(r["context"] or ""),
            }
            for r in conn.execute(
                "SELECT source_path, relation_type, target, context FROM relations "
                f"WHERE source_path IN ({changed_sql}) "
                "ORDER BY source_path, relation_type, target",
                params,
            )
        ]

        observations = [
            {
                "source_path": str(r["source_path"]),
                "ordinal": int(r["ordinal"]),
                "category": str(r["category"]),
                "content": str(r["content"]),
                # Stored space-joined (see store.py); the wire wants a list.
                "tags": str(r["tags"] or "").split(),
            }
            for r in conn.execute(
                "SELECT source_path, ordinal, category, content, tags FROM observations "
                f"WHERE source_path IN ({changed_sql}) "
                "ORDER BY source_path, ordinal",
                params,
            )
        ]
    finally:
        conn.close()

    return {
        "schema": DUMP_SCHEMA_VERSION,
        "embedder": embedder,
        "dim": dim,
        "manifest": manifest,
        "notes": notes,
        "chunks": chunks,
        "relations": relations,
        "observations": observations,
        "count": {
            "notes": len(notes),
            "chunks": len(chunks),
            "relations": len(relations),
            "observations": len(observations),
        },
    }


def embed_query(vault: Path, query: str, *, embedder_name: str | None = None) -> dict:
    """The ``json-embed-query`` payload: one query vector, wire-encoded.

    The embedder's own :meth:`~.embeddings.Embedder.embed` already L2-normalizes
    (both :class:`~.embeddings.HashingEmbedder` and
    :class:`~.embeddings.FastEmbedEmbedder` run ``_l2_normalize``) — the exact
    same path ``index_vectors`` used to build the stored chunks, so the query
    vector is directly comparable (cosine == dot) with what the dump shipped.

    Error cases return ``{"error": str}`` for exit 0 — the consumer treats a
    vault without vectors as "vector search unavailable", not a crash:

    - no ``note_chunks`` rows at all -> ``"no vectors indexed"``;
    - a dominant identity this build cannot reconstruct (e.g. a ``fastembed:``
      index moved to a machine without the extra) -> a descriptive error;
    - a feature-less query (pure punctuation/emoji/whitespace) whose embedding
      is the zero vector -> ``"query produced an empty embedding"`` (cosine
      distance against a zero vector is NaN in pgvector, so shipping it would
      yield arbitrary ordering presented as a successful search).
    """
    conn = _open_index(vault)
    try:
        if not has_any_chunks(conn):
            return {"error": "no vectors indexed"}
        dominant = dominant_embedder_name(conn)
    finally:
        conn.close()

    if embedder_name is not None:
        embedder = get_embedder(embedder_name)
    else:
        embedder = embedder_for_identity(dominant) if dominant is not None else None
        if embedder is None:
            return {"error": f"cannot reconstruct embedder for identity {dominant!r}"}

    vec = embedder.embed([query])[0]
    # A query with no word tokens hashes to the zero vector and _l2_normalize
    # is a deliberate no-op on zero norm — return the documented {"error"} shape
    # instead of a valid-looking payload that NaNs every pgvector comparison.
    if not any(vec):
        return {"error": "query produced an empty embedding"}
    return {"embedder": embedder.name, "dim": len(vec), "vec_b64": _f32le_b64(vec.tobytes())}

"""FTS5 search with BM25 ranking."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from .paths import index_db_path
from .store import connect, init_schema
from .vector_store import ChunkHit, search_chunks

if TYPE_CHECKING:
    from .embeddings import Embedder


def build_match_query(user_query: str) -> str | None:
    """Build a conservative FTS5 MATCH string (AND of body: terms)."""
    raw = user_query.strip()
    if not raw:
        return None
    parts = re.split(r"\s+", raw)
    clauses: list[str] = []
    for p in parts:
        safe = re.sub(r'[^\w\-.@/]', '', p, flags=re.UNICODE)
        if not safe:
            continue
        esc = safe.replace('"', '""')
        clauses.append(f'body: "{esc}"')
    if not clauses:
        return None
    return " AND ".join(clauses)


@dataclass
class SearchHit:
    path: str
    title: str
    mtime_ns: int
    snippet: str
    bm25: float


def search_vault(
    vault: Path,
    query: str,
    *,
    limit: int = 20,
) -> list[SearchHit]:
    vault = vault.resolve()
    db_path = index_db_path(vault)
    if not db_path.is_file():
        return []
    match = build_match_query(query)
    if not match:
        return []

    conn = connect(db_path)
    try:
        init_schema(conn)
        sql = """
        SELECT path, mtime_ns, title,
               snippet(vault_fts, 3, '[', ']', '…', 24) AS snip,
               bm25(vault_fts) AS score
        FROM vault_fts
        WHERE vault_fts MATCH ?
        ORDER BY score
        LIMIT ?
        """
        cur = conn.execute(sql, (match, limit))
        rows = cur.fetchall()
    finally:
        conn.close()

    out: list[SearchHit] = []
    for r in rows:
        out.append(
            SearchHit(
                path=str(r["path"]),
                title=str(r["title"] or ""),
                mtime_ns=int(r["mtime_ns"]),
                snippet=str(r["snip"] or ""),
                bm25=float(r["score"]),
            )
        )
    return out


@dataclass
class HybridHit:
    path: str
    heading: str  # the matched chunk's section heading (or note title)
    snippet: str  # the matched chunk text — the agent reads this, not the whole note
    score: float  # fused Reciprocal-Rank-Fusion score (higher is better)
    bm25_rank: int | None  # 1-based rank in the BM25 list, or None if absent
    vector_rank: int | None  # 1-based rank in the vector list, or None if absent


def semantic_search(
    vault: Path, query: str, embedder: "Embedder", *, limit: int = 20
) -> list[ChunkHit]:
    """Rank note *chunks* by embedding cosine similarity to ``query`` (best first)."""
    vault = vault.resolve()
    db_path = index_db_path(vault)
    if not db_path.is_file():
        return []
    qvec = embedder.embed([query])[0]
    conn = connect(db_path)
    try:
        return search_chunks(conn, qvec, embedder.name, limit)
    finally:
        conn.close()


def reciprocal_rank_fusion(
    rankings: list[list[str]], *, k: int = 60, limit: int = 20
) -> list[tuple[str, float]]:
    """Fuse several best-first path rankings into one (RRF; Cormack et al. 2009).

    Each list contributes ``1 / (k + rank)`` per item, so the method is robust to
    the two rankers using different score scales (BM25 distance vs cosine).
    """
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, path in enumerate(ranking, start=1):
            scores[path] = scores.get(path, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:limit]


def hybrid_search(
    vault: Path,
    query: str,
    embedder: "Embedder",
    *,
    limit: int = 20,
    candidate_pool: int = 50,
) -> list[HybridHit]:
    """Combine BM25 (lexical) and vector cosine (semantic) via RRF.

    Degrades gracefully: with no vectors indexed the semantic list is empty and
    the result is just the BM25 ranking; with no lexical match a note can still
    surface on semantic similarity alone.
    """
    bm = search_vault(vault, query, limit=candidate_pool)
    # Pull extra chunks so several notes are represented even when one note owns
    # the top hits; collapse to each note's best (first-seen, since sorted) chunk.
    sem = semantic_search(vault, query, embedder, limit=candidate_pool * 3)
    best_chunk: dict[str, ChunkHit] = {}
    sem_paths: list[str] = []
    for ch in sem:
        if ch.path not in best_chunk:
            best_chunk[ch.path] = ch
            sem_paths.append(ch.path)

    bm_paths = [h.path for h in bm]
    fused = reciprocal_rank_fusion([bm_paths, sem_paths], limit=limit)

    bm_rank = {p: i + 1 for i, p in enumerate(bm_paths)}
    sem_rank = {p: i + 1 for i, p in enumerate(sem_paths)}
    bm_by_path = {h.path: h for h in bm}

    out: list[HybridHit] = []
    for path, score in fused:
        ch = best_chunk.get(path)
        if ch is not None:
            heading, snippet = ch.heading, ch.text
        else:
            h = bm_by_path.get(path)
            heading = h.title if h else ""
            snippet = h.snippet if h else ""
        out.append(
            HybridHit(path, heading, snippet, score, bm_rank.get(path), sem_rank.get(path))
        )
    return out

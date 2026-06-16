"""FTS5 search with BM25 ranking."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from .graphlink import neighbor_paths
from .paths import index_db_path
from .store import connect, init_schema
from .vector_store import ChunkHit, search_chunks

if TYPE_CHECKING:
    from .embeddings import Embedder


def build_match_query(user_query: str, *, op: str = "AND") -> str | None:
    """Build an FTS5 MATCH string from the query terms.

    ``op="AND"`` (default) is precision-first: every term must appear. ``op="OR"``
    is the recall fallback used by :func:`search_vault` when the AND query matches
    nothing — without it, one stray term (a typo, an inflection the note doesn't
    use) drops an otherwise-relevant note entirely on a pure-FTS install.
    """
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
    joiner = " OR " if op.upper() == "OR" else " AND "
    return joiner.join(clauses)


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

    sql = """
    SELECT path, mtime_ns, title,
           snippet(vault_fts, 3, '[', ']', '…', 24) AS snip,
           bm25(vault_fts) AS score
    FROM vault_fts
    WHERE vault_fts MATCH ?
    ORDER BY score
    LIMIT ?
    """
    conn = connect(db_path)
    try:
        init_schema(conn)
        rows = conn.execute(sql, (match, limit)).fetchall()
        if not rows:
            # Precision-first AND found nothing — fall back to OR so a single
            # missing/typo'd term doesn't drop an otherwise-relevant note. Skipped
            # for single-term queries (OR == AND there, so no second round-trip).
            or_match = build_match_query(query, op="OR")
            if or_match and or_match != match:
                rows = conn.execute(sql, (or_match, limit)).fetchall()
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
    graph_rank: int | None = None  # 1-based rank among [[wikilink]] neighbours, or None


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


def graph_neighbors(vault: Path, seeds: list[str], *, limit: int = 50) -> list[str]:
    """Notes one hop from ``seeds`` in the ``[[wikilink]]`` graph (best first).

    Thin DB-opening wrapper over :func:`graphlink.neighbor_paths`; returns ``[]``
    when no index exists yet.
    """
    vault = vault.resolve()
    db_path = index_db_path(vault)
    if not db_path.is_file():
        return []
    conn = connect(db_path)
    try:
        init_schema(conn)
        return neighbor_paths(conn, seeds, limit=limit)
    finally:
        conn.close()


def _note_cards(vault: Path, paths: list[str]) -> dict[str, tuple[str, str]]:
    """``path -> (title, short snippet)`` for notes lacking a chunk/BM25 hit.

    Used to give graph-only neighbours a display heading + passage without a
    second full read. Pulls the title and a body prefix from the FTS index.
    """
    out: dict[str, tuple[str, str]] = {}
    if not paths:
        return out
    db_path = index_db_path(vault.resolve())
    if not db_path.is_file():
        return out
    conn = connect(db_path)
    try:
        placeholders = ",".join("?" * len(paths))
        rows = conn.execute(
            f"SELECT path, title, substr(body, 1, 240) AS snip "
            f"FROM vault_fts WHERE path IN ({placeholders})",
            list(paths),
        ).fetchall()
    finally:
        conn.close()
    for r in rows:
        out[str(r["path"])] = (str(r["title"] or ""), str(r["snip"] or "").strip())
    return out


def hybrid_search(
    vault: Path,
    query: str,
    embedder: "Embedder",
    *,
    limit: int = 20,
    candidate_pool: int = 50,
    graph: bool = False,
    graph_seeds: int = 10,
) -> list[HybridHit]:
    """Combine BM25 (lexical) and vector cosine (semantic) via RRF.

    Degrades gracefully: with no vectors indexed the semantic list is empty and
    the result is just the BM25 ranking; with no lexical match a note can still
    surface on semantic similarity alone.

    With ``graph=True`` a third ranking is fused in: notes one hop from the
    strongest ``graph_seeds`` hits in the ``[[wikilink]]`` graph (ADR-0019). RRF's
    ``1/(k+rank)`` damping keeps this a soft boost — a strongly-linked note can
    surface, but the link signal cannot outvote agreement between BM25 and cosine.
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
    rankings = [bm_paths, sem_paths]

    graph_paths: list[str] = []
    if graph:
        seeds = list(dict.fromkeys(bm_paths[:graph_seeds] + sem_paths[:graph_seeds]))
        graph_paths = graph_neighbors(vault, seeds, limit=candidate_pool)
        if graph_paths:
            rankings.append(graph_paths)

    fused = reciprocal_rank_fusion(rankings, limit=limit)

    bm_rank = {p: i + 1 for i, p in enumerate(bm_paths)}
    sem_rank = {p: i + 1 for i, p in enumerate(sem_paths)}
    graph_rank = {p: i + 1 for i, p in enumerate(graph_paths)}
    bm_by_path = {h.path: h for h in bm}

    # Graph-only neighbours have neither a chunk nor a BM25 row — fetch a card so
    # they still display a heading + passage.
    need_card = [p for p, _ in fused if p not in best_chunk and p not in bm_by_path]
    cards = _note_cards(vault, need_card)

    out: list[HybridHit] = []
    for path, score in fused:
        ch = best_chunk.get(path)
        if ch is not None:
            heading, snippet = ch.heading, ch.text
        else:
            h = bm_by_path.get(path)
            if h is not None:
                heading, snippet = h.title, h.snippet
            else:
                heading, snippet = cards.get(path, ("", ""))
        out.append(
            HybridHit(
                path,
                heading,
                snippet,
                score,
                bm_rank.get(path),
                sem_rank.get(path),
                graph_rank.get(path),
            )
        )
    return out

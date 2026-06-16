"""FTS5 search with BM25 ranking."""

from __future__ import annotations

import math
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from .graphlink import neighbor_paths
from .paths import index_db_path
from .store import connect, init_schema
from .vector_store import ChunkHit, search_chunks

if TYPE_CHECKING:
    from .embeddings import Embedder


# BM25F column weights for `search_vault` (FTS5 `bm25()` takes one weight per
# column, in declaration order: path, mtime_ns — both UNINDEXED, weight ignored —
# then title, body). The note title (its first heading, e.g. "sqlite" or "go") is
# the single most topical, highest-signal field, and it is stripped out of `body`
# (see markdown_io.split_title_body) — so before title-aware matching a query for a
# note's own name could miss it entirely. Weighting title above body makes a
# name-matching hit rank first without drowning body matches.
TITLE_WEIGHT = 2.0
BODY_WEIGHT = 1.0


def build_match_query(user_query: str, *, op: str = "AND") -> str | None:
    """Build an FTS5 MATCH string from the query terms.

    Terms match across both indexed columns (title and body); ``search_vault``
    weights title higher via BM25F (see :data:`TITLE_WEIGHT`). ``op="AND"``
    (default) is precision-first: every term must appear. ``op="OR"`` is the recall
    fallback used by :func:`search_vault` when the AND query matches nothing —
    without it, one stray term (a typo, an inflection the note doesn't use) drops
    an otherwise-relevant note entirely on a pure-FTS install.
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
        clauses.append(f'"{esc}"')
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

    # BM25F: weight the title column above body (path/mtime are UNINDEXED, so their
    # weights are inert placeholders). Weights are our own float constants, never
    # user input, so formatting them into the SQL is injection-safe.
    sql = f"""
    SELECT path, mtime_ns, title,
           snippet(vault_fts, 3, '[', ']', '…', 24) AS snip,
           bm25(vault_fts, 1.0, 1.0, {TITLE_WEIGHT}, {BODY_WEIGHT}) AS score
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


# Per-ranker RRF weights. Lexical and semantic carry equal vote (the default
# hybrid behaviour is unchanged byte-for-byte). The wikilink graph is deliberately
# much weaker: it is a *soft* recall boost (ADR-0019), and because RRF scores are
# densely packed (k=60 squeezes the whole candidate pool into a narrow band) an
# equal-weight graph term reorders aggressively — it can shove a genuinely-relevant
# note that is a strong BM25+cosine hit but *not* a wikilink neighbour out of the
# top-k. Measured on the retrieval bench: equal-weight graph fusion dropped
# recall@5 1.000→0.938 on multi-relevant queries. The weight below was tuned on
# that bench (see ADR-0021): 0.1 fully restores the or-fallback benefit it exists
# for (or-fallback MRR 0.750→1.000) while keeping graph-on aggregate recall ≥ 0.98.
BM25_WEIGHT = 1.0
VECTOR_WEIGHT = 1.0
GRAPH_WEIGHT = 0.1

# Optional recency bias (Generative Agents, Park et al. UIST 2023: retrieval ≈
# recency × relevance). When enabled, a note's fused score is multiplied by an
# exponential decay of its age, so among comparably-relevant notes the freshest
# wins — matching the evolving-memory doctrine (a decision recorded last week
# should outrank a year-old one of equal textual match). The factor is ≤ 1 and
# equals 1.0 at age 0, so recency can only *demote* stale notes, never invent
# relevance. Off by default: it changes ranking and is not validated by the
# fixed-corpus bench (which has near-uniform mtimes), so it ships behind a flag
# pending real-vault evaluation (ADR-0021).
RECENCY_HALF_LIFE_DAYS = 90.0
_NS_PER_DAY = 86_400 * 1_000_000_000


def recency_factor(now_ns: int, mtime_ns: int | None, half_life_days: float) -> float:
    """Exponential time-decay multiplier in ``(0, 1]`` for a note's modified time.

    ``0.5 ** (age_days / half_life_days)``: 1.0 for a just-touched note, 0.5 at one
    half-life, asymptotically 0 for ancient notes. A missing/future mtime yields
    1.0 (no penalty). Half-life ≤ 0 disables decay (returns 1.0).
    """
    if mtime_ns is None or half_life_days <= 0:
        return 1.0
    age_days = max(0.0, (now_ns - mtime_ns) / _NS_PER_DAY)
    return math.pow(0.5, age_days / half_life_days)


def reciprocal_rank_fusion(
    rankings: list[list[str]],
    *,
    weights: list[float] | None = None,
    k: int = 60,
    limit: int = 20,
) -> list[tuple[str, float]]:
    """Fuse several best-first path rankings into one (RRF; Cormack et al. 2009).

    Each list contributes ``weight / (k + rank)`` per item, so the method is robust
    to the rankers using different score scales (BM25 distance vs cosine vs graph
    adjacency). ``weights`` defaults to 1.0 for every ranking (plain RRF); pass
    smaller weights to make a ranking a soft signal that nudges but cannot outvote
    agreement between the stronger rankers (weighted RRF — Bruch et al. 2023).
    """
    if weights is None:
        weights = [1.0] * len(rankings)
    scores: dict[str, float] = {}
    for weight, ranking in zip(weights, rankings):
        for rank, path in enumerate(ranking, start=1):
            scores[path] = scores.get(path, 0.0) + weight / (k + rank)
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


def _note_mtimes(vault: Path, paths: list[str]) -> dict[str, int]:
    """``path -> mtime_ns`` from the FTS index for the given paths (recency bias)."""
    out: dict[str, int] = {}
    if not paths:
        return out
    db_path = index_db_path(vault.resolve())
    if not db_path.is_file():
        return out
    conn = connect(db_path)
    try:
        placeholders = ",".join("?" * len(paths))
        rows = conn.execute(
            f"SELECT path, mtime_ns FROM vault_fts WHERE path IN ({placeholders})",
            list(paths),
        ).fetchall()
    finally:
        conn.close()
    for r in rows:
        out[str(r["path"])] = int(r["mtime_ns"])
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
    graph_weight: float = GRAPH_WEIGHT,
    recency: bool = False,
    recency_half_life_days: float = RECENCY_HALF_LIFE_DAYS,
) -> list[HybridHit]:
    """Combine BM25 (lexical) and vector cosine (semantic) via RRF.

    Degrades gracefully: with no vectors indexed the semantic list is empty and
    the result is just the BM25 ranking; with no lexical match a note can still
    surface on semantic similarity alone.

    With ``graph=True`` a third ranking is fused in: notes one hop from the
    strongest ``graph_seeds`` hits in the ``[[wikilink]]`` graph (ADR-0019). It
    enters weighted RRF at ``graph_weight`` (< 1) so a strongly-linked note can
    surface, but the link signal cannot outvote — or displace a relevant hit
    found by — the agreement between BM25 and cosine.

    With ``recency=True`` the fused scores are multiplied by an exponential decay
    of each note's modified time (:func:`recency_factor`, half-life
    ``recency_half_life_days``), so the freshest of comparably-relevant notes wins.
    Off by default — it changes ranking and is not part of the deterministic bench.
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
    weights = [BM25_WEIGHT, VECTOR_WEIGHT]

    graph_paths: list[str] = []
    if graph:
        seeds = list(dict.fromkeys(bm_paths[:graph_seeds] + sem_paths[:graph_seeds]))
        graph_paths = graph_neighbors(vault, seeds, limit=candidate_pool)
        if graph_paths:
            rankings.append(graph_paths)
            weights.append(graph_weight)

    # When recency-biasing, fuse a wider pool first so the decay can pull a fresh
    # note up from just outside the top-``limit``, then trim. Otherwise the result
    # is byte-identical to plain weighted RRF.
    fused = reciprocal_rank_fusion(
        rankings, weights=weights, limit=max(limit, candidate_pool) if recency else limit
    )
    if recency:
        mtimes = _note_mtimes(vault, [p for p, _ in fused])
        now_ns = time.time_ns()
        fused = sorted(
            (
                (p, s * recency_factor(now_ns, mtimes.get(p), recency_half_life_days))
                for p, s in fused
            ),
            key=lambda kv: kv[1],
            reverse=True,
        )[:limit]

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

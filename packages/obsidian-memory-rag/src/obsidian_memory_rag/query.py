"""FTS5 search with BM25 ranking."""

from __future__ import annotations

import math
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from .graphlink import _build_resolver, neighbor_paths, typed_neighbor_paths
from .paths import in_section, index_db_path, section_sql_filter, validate_section
from .store import connect, init_schema
from .vector_store import ChunkHit, fetch_adjacent_chunks, fetch_chunk_vecs, search_chunks

if TYPE_CHECKING:
    from array import array as _Array

    from .embeddings import Embedder
    from .rerank import Reranker


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
    section: str | None = None,
) -> list[SearchHit]:
    """``section``: 'research' = only RESEARCH/**, 'memory' = everything except,
    None (default) = unfiltered — byte-identical to the pre-section ranking. The
    filter is a SQL WHERE clause, so it narrows candidates BEFORE ``LIMIT`` (a
    post-filter on the returned rows would silently return fewer than ``limit``).
    """
    validate_section(section)
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
    section_clause, section_params = section_sql_filter(section)
    sql = f"""
    SELECT path, mtime_ns, title,
           snippet(vault_fts, 3, '[', ']', '…', 24) AS snip,
           bm25(vault_fts, 1.0, 1.0, {TITLE_WEIGHT}, {BODY_WEIGHT}) AS score
    FROM vault_fts
    WHERE vault_fts MATCH ?{section_clause}
    ORDER BY score, path
    LIMIT ?
    """
    conn = connect(db_path)
    try:
        init_schema(conn)
        rows = conn.execute(sql, (match, *section_params, limit)).fetchall()
        if not rows:
            # Precision-first AND found nothing — fall back to OR so a single
            # missing/typo'd term doesn't drop an otherwise-relevant note. Skipped
            # for single-term queries (OR == AND there, so no second round-trip).
            or_match = build_match_query(query, op="OR")
            if or_match and or_match != match:
                rows = conn.execute(sql, (or_match, *section_params, limit)).fetchall()
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
    rerank_score: float | None = None  # cross-encoder logit (relative), or None if not reranked


def semantic_search(
    vault: Path, query: str, embedder: "Embedder", *, limit: int = 20,
    section: str | None = None,
) -> list[ChunkHit]:
    """Rank note *chunks* by embedding cosine similarity to ``query`` (best first).

    ``section`` narrows the candidate chunks before the top-``limit`` cut (see
    :func:`vector_store.search_chunks`); caller is expected to have validated it.
    """
    vault = vault.resolve()
    db_path = index_db_path(vault)
    if not db_path.is_file():
        return []
    qvec = embedder.embed([query])[0]
    conn = connect(db_path)
    try:
        return search_chunks(conn, qvec, embedder.name, limit, section=section)
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

# Optional importance bias (ADR-0027), completing the Generative-Agents triad
# (retrieval ≈ relevance × recency × importance). A note's importance is its
# in-degree in the typed relations graph — a hub that many notes point at
# (`MEMORY.md`, a load-bearing `STACKS/*`) is structurally more central. The factor
# is a bounded *boost* (1 + weight × normalized-in-degree, capped at `1 + weight`)
# so a hub can win among comparably-relevant notes but the boost can never invent
# relevance for an off-topic hub. Off by default (it changes ranking).
IMPORTANCE_WEIGHT = 0.15

# Optional failure-pinning (ADR-0038, evolutive memory). Notes carrying a
# `[failure]` / `[gotcha]` observation are recorded lessons — exactly the memory
# that should resurface when a matching task comes back. When enabled, a fourth
# RRF ranking lists the candidate notes (already matched by BM25 or vector) that
# carry such an observation, fused at a small weight like the graph signal: a
# nudge among comparably-relevant notes, never able to outvote BM25+cosine
# agreement or to surface an off-topic failure note. Off by default.
FAILURE_WEIGHT = 0.15
FAILURE_CATEGORIES = ("failure", "gotcha")

# Optional usage reinforcement (ADR-0038): memory that demonstrably helped —
# search returned it AND the agent then opened it (recall_log 'used' events) —
# gets a bounded multiplicative boost, log-damped so a runaway favourite cannot
# monopolize ranking: 1 + weight × log1p(uses)/log1p(max_uses). Like recency/
# importance it can only promote among already-matched candidates. Off by
# default; an empty log makes it an exact no-op.
#
# ``uses`` is not a flat count of events inside the window — that would let a
# note that racked up hits near the *start* of the 90-day window keep full
# credit right up until it ages out (a cliff, not a taper), permanently
# outranking a brand-new, equally-relevant note that starts at zero by
# construction. That is the opposite of ADR-0038's stated goal ("a decision
# recorded last week should outrank a year-old one") unless the independent
# ``recency`` lever is also on. Instead each 'used' event is weighted by its
# own recency (see :func:`recall_log.usage_counts_decayed`) before the
# log1p — so an old note's boost genuinely fades once nobody has touched it
# recently, even while it is still technically inside the window.
USAGE_WEIGHT = 0.15
USAGE_WINDOW_DAYS = 90.0

# Optional cross-encoder reranking (ADR-0026). When a reranker is supplied,
# hybrid_search widens the fused pool to this many candidates and re-scores their
# passages jointly with the query, reordering by the (relative) cross-encoder logit.
RERANK_POOL = 60
# Abstention cutoff: drop reranked passages whose logit is more than this far below
# the top. Default OFF (reorder-only) — a margin cut with a weak or wrong-language
# reranker can drop correct answers (measured: a small English model on a Spanish/
# synonym corpus cut true hits), so cutting is an opt-in choice for a *validated*
# model that wants no-answer abstention, not the default. None = pure reorder.
RERANK_MARGIN = None


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
    # Path ascending as the explicit tie-break: without it, ties fall back to dict
    # insertion order — which descends from ranking-input order and ultimately from
    # filesystem walk order, i.e. it differs across platforms for the same vault.
    return sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]


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


def typed_graph_neighbors(vault: Path, seeds: list[str], *, limit: int = 50) -> list[str]:
    """Type-weighted variant of :func:`graph_neighbors` (ADR-0027).

    Ranks one-hop neighbours from the persisted typed ``relations`` table, weighting
    each edge by its verb. Returns ``[]`` when no index/relations exist.
    """
    vault = vault.resolve()
    db_path = index_db_path(vault)
    if not db_path.is_file():
        return []
    conn = connect(db_path)
    try:
        init_schema(conn)
        return typed_neighbor_paths(conn, seeds, limit=limit)
    finally:
        conn.close()


def _chunk_vecs(vault: Path, embedder_name: str, items: list[tuple[str, int]]) -> dict[str, "_Array"]:
    """Open the index and return ``{path: vec}`` for the given chunk keys (MMR)."""
    if not items:
        return {}
    db_path = index_db_path(vault.resolve())
    if not db_path.is_file():
        return {}
    conn = connect(db_path)
    try:
        return fetch_chunk_vecs(conn, items, embedder_name)
    finally:
        conn.close()


def _expanded_passage(
    vault: Path, embedder_name: str, path: str, ordinal: int, window: int
) -> str:
    """Concatenated text of a chunk and its ``window`` neighbours (passage expansion)."""
    db_path = index_db_path(vault.resolve())
    if not db_path.is_file():
        return ""
    conn = connect(db_path)
    try:
        chunks = fetch_adjacent_chunks(conn, path, ordinal, window, embedder_name)
    finally:
        conn.close()
    return "\n\n".join(t for _, _, t in chunks if t)


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


def _note_indegree(vault: Path, paths: list[str]) -> dict[str, int]:
    """``path -> in-degree`` over the typed relations graph (importance bias).

    In-degree = how many notes point at this one (resolved targets), a cheap,
    deterministic centrality proxy. Returns zeros when the relations table is
    absent so importance biasing degrades to a no-op.
    """
    out = {p: 0 for p in paths}
    if not paths:
        return out
    db_path = index_db_path(vault.resolve())
    if not db_path.is_file():
        return out
    conn = connect(db_path)
    try:
        init_schema(conn)
        try:
            rows = conn.execute("SELECT target FROM relations").fetchall()
        except Exception:
            return out
        if not rows:
            return out
        all_paths = [str(r["path"]) for r in conn.execute("SELECT path FROM vault_fts").fetchall()]
        resolve = _build_resolver(all_paths)
        wanted = set(paths)
        counts: dict[str, int] = {}
        for r in rows:
            dst = resolve(str(r["target"]))
            if dst is not None and dst in wanted:
                counts[dst] = counts.get(dst, 0) + 1
    finally:
        conn.close()
    for p in paths:
        out[p] = counts.get(p, 0)
    return out


def _failure_note_paths(vault: Path) -> set[str]:
    """Paths of notes carrying at least one failure/gotcha observation.

    Backed by the persisted ``observations`` table (ADR-0023) and its category
    index — one cheap SELECT. Empty set when the index/table is absent so the
    lever degrades to a no-op.
    """
    db_path = index_db_path(vault.resolve())
    if not db_path.is_file():
        return set()
    conn = connect(db_path)
    try:
        init_schema(conn)
        placeholders = ",".join("?" * len(FAILURE_CATEGORIES))
        rows = conn.execute(
            f"SELECT DISTINCT source_path FROM observations "
            f"WHERE lower(category) IN ({placeholders})",
            [c.lower() for c in FAILURE_CATEGORIES],
        ).fetchall()
    except Exception:
        return set()
    finally:
        conn.close()
    return {str(r["source_path"]) for r in rows}


def _cosine(a: "_Array | None", b: "_Array | None") -> float:
    """Dot product of two L2-normalized vectors (== cosine), 0.0 if either missing."""
    if a is None or b is None or len(a) != len(b):
        return 0.0
    return math.fsum(x * y for x, y in zip(a, b))


def _mmr_order(
    fused: list[tuple[str, float]],
    chunk_vecs: dict[str, "_Array"],
    lambda_: float,
    limit: int,
) -> list[tuple[str, float]]:
    """Greedy Maximal Marginal Relevance reorder (Carbonell & Goldstein 1998).

    Repeatedly picks the candidate maximizing
    ``λ·rel(p) − (1−λ)·max_{s∈selected} cos(p, s)`` so each pick trades relevance
    against redundancy with what is already chosen. Relevance is the fused RRF score,
    min-max normalized to [0, 1] so λ mixes the two terms on the same scale. A note
    with no stored vector contributes 0 similarity (treated as maximally novel), so
    it is never unfairly demoted. Returns at most ``limit`` ``(path, fused_score)``.
    """
    if not fused:
        return []
    rel = dict(fused)
    vals = list(rel.values())
    rmin, rmax = min(vals), max(vals)
    span = (rmax - rmin) or 1.0

    def reln(p: str) -> float:
        return (rel[p] - rmin) / span

    remaining = [p for p, _ in fused]
    selected: list[str] = []
    while remaining and len(selected) < limit:
        best_p = None
        best_val = None
        for p in remaining:
            if selected:
                vp = chunk_vecs.get(p)
                div = max((_cosine(vp, chunk_vecs.get(s)) for s in selected), default=0.0)
            else:
                div = 0.0
            val = lambda_ * reln(p) - (1.0 - lambda_) * div
            if best_val is None or val > best_val:
                best_val, best_p = val, p
        selected.append(best_p)  # type: ignore[arg-type]
        remaining.remove(best_p)  # type: ignore[arg-type]
    return [(p, rel[p]) for p in selected]


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
    graph_typed: bool = False,
    recency: bool = False,
    recency_half_life_days: float = RECENCY_HALF_LIFE_DAYS,
    importance: bool = False,
    importance_weight: float = IMPORTANCE_WEIGHT,
    pin_failures: bool = False,
    failure_weight: float = FAILURE_WEIGHT,
    usage: bool = False,
    usage_weight: float = USAGE_WEIGHT,
    usage_window_days: float = USAGE_WINDOW_DAYS,
    mmr: bool = False,
    mmr_lambda: float = 0.5,
    passage_window: int = 0,
    reranker: "Reranker | None" = None,
    rerank_pool: int = RERANK_POOL,
    rerank_margin: float | None = RERANK_MARGIN,
    section: str | None = None,
) -> list[HybridHit]:
    """Combine BM25 (lexical) and vector cosine (semantic) via RRF.

    Degrades gracefully: with no vectors indexed the semantic list is empty and
    the result is just the BM25 ranking; with no lexical match a note can still
    surface on semantic similarity alone.

    All optional stages below are **off by default**, so the default call is
    byte-identical to plain weighted RRF (the deterministic bench path):

    - ``graph=True`` fuses a third ranking — notes one hop from the strongest
      ``graph_seeds`` hits in the ``[[wikilink]]`` graph (ADR-0019), entering RRF at
      the small ``graph_weight`` so it nudges but never outvotes BM25+cosine. With
      ``graph_typed=True`` that ranking comes from the *typed* relations table,
      verb-weighted (ADR-0027), so ``supersedes``/``implements`` neighbours outrank
      bare links.
    - ``recency=True`` multiplies fused scores by an exponential mtime decay so the
      freshest of comparably-relevant notes wins.
    - ``importance=True`` multiplies by a bounded in-degree boost (Generative-Agents
      relevance×recency×importance, ADR-0027) so a hub note wins among ties.
    - ``pin_failures=True`` fuses a low-weight ranking of the candidates that carry
      a ``[failure]``/``[gotcha]`` observation (ADR-0038), so recorded lessons edge
      out neutral notes of comparable relevance when a matching task returns.
    - ``usage=True`` multiplies by a bounded, log-damped boost from recall_log
      'used' events (ADR-0038): memory that repeatedly and *recently* helped
      ranks higher among comparables (each event's weight decays with its own
      age, see ``USAGE_WEIGHT`` above); an empty log is an exact no-op.
    - ``mmr=True`` reorders the fused pool for diversity (Maximal Marginal Relevance)
      using the stored chunk vectors; ``mmr_lambda`` trades relevance vs. novelty.
    - ``reranker`` (an optional cross-encoder, ADR-0026) re-scores the fused pool's
      passages jointly with the query and keeps those within ``rerank_margin`` of the
      top logit. It is the precision authority and takes precedence over ``mmr``.
    - ``passage_window > 0`` widens each chunk hit's returned snippet to its adjacent
      chunks (richer context for the agent); ranking is unaffected.
    - ``section`` (spec vkm-research R4) restricts the candidate pool to a vault
      section — 'research' = only RESEARCH/**, 'memory' = everything except, None
      (default) = unfiltered, byte-identical to the pre-section ranking. Cuts at
      EVERY candidate source (BM25, vector, graph neighbours) before fusion, and
      is re-checked as a final invariant on the fused result so no downstream
      stage (rerank/mmr/usage) can let a wrong-section note slip through.
    """
    validate_section(section)
    bm = search_vault(vault, query, limit=candidate_pool, section=section)
    # Pull extra chunks so several notes are represented even when one note owns
    # the top hits; collapse to each note's best (first-seen, since sorted) chunk.
    sem = semantic_search(vault, query, embedder, limit=candidate_pool * 3, section=section)
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
        if graph_typed:
            graph_paths = typed_graph_neighbors(vault, seeds, limit=candidate_pool)
        else:
            graph_paths = graph_neighbors(vault, seeds, limit=candidate_pool)
        # A [[wikilink]] neighbour can resolve to either section regardless of the
        # seeds' section, so it needs its own cut (the seeds being pre-filtered
        # isn't enough — the link graph itself is section-agnostic).
        graph_paths = [p for p in graph_paths if in_section(p, section)]
        if graph_paths:
            rankings.append(graph_paths)
            weights.append(graph_weight)

    if pin_failures:
        failure_set = _failure_note_paths(vault)
        if failure_set:
            # Only candidates the query already surfaced (BM25 or vector order,
            # BM25 first) — pinning boosts matched lessons, it never imports
            # unrelated failure notes into the pool.
            pinned = [p for p in bm_paths if p in failure_set]
            pinned += [p for p in sem_paths if p in failure_set and p not in pinned]
            if pinned:
                rankings.append(pinned)
                weights.append(failure_weight)

    # Any post-fusion stage (recency/importance multiply, MMR, rerank) needs a wider
    # candidate pool so an item from just outside the top-``limit`` can be promoted;
    # with every stage off the result is byte-identical to plain weighted RRF.
    widen = recency or importance or usage or mmr or reranker is not None
    fused = reciprocal_rank_fusion(
        rankings, weights=weights, limit=max(limit, candidate_pool) if widen else limit
    )

    if recency:
        mtimes = _note_mtimes(vault, [p for p, _ in fused])
        now_ns = time.time_ns()
        fused = [
            (p, s * recency_factor(now_ns, mtimes.get(p), recency_half_life_days))
            for p, s in fused
        ]
    if importance:
        indeg = _note_indegree(vault, [p for p, _ in fused])
        max_deg = max(indeg.values(), default=0)
        if max_deg > 0:
            fused = [
                (p, s * (1.0 + importance_weight * (indeg.get(p, 0) / max_deg)))
                for p, s in fused
            ]
    if usage:
        from .recall_log import usage_counts_decayed

        uses = usage_counts_decayed(vault, [p for p, _ in fused], window_days=usage_window_days)
        max_uses = max(uses.values(), default=0.0)
        if max_uses > 0:
            denom = math.log1p(max_uses)
            fused = [
                (p, s * (1.0 + usage_weight * (math.log1p(uses.get(p, 0.0)) / denom)))
                for p, s in fused
            ]
    if recency or importance or usage:
        # Same deterministic tie-break as reciprocal_rank_fusion: score desc, path asc.
        fused.sort(key=lambda kv: (-kv[1], kv[0]))

    bm_rank = {p: i + 1 for i, p in enumerate(bm_paths)}
    sem_rank = {p: i + 1 for i, p in enumerate(sem_paths)}
    graph_rank = {p: i + 1 for i, p in enumerate(graph_paths)}
    bm_by_path = {h.path: h for h in bm}

    # Graph-only neighbours have neither a chunk nor a BM25 row — fetch a card so
    # they still display (and can be reranked on) a heading + passage.
    need_card = [p for p, _ in fused if p not in best_chunk and p not in bm_by_path]
    cards = _note_cards(vault, need_card)

    def passage_for(path: str) -> str:
        ch = best_chunk.get(path)
        if ch is not None:
            return ch.text
        h = bm_by_path.get(path)
        if h is not None:
            return h.snippet
        return cards.get(path, ("", ""))[1]

    rerank_scores: dict[str, float] = {}
    if reranker is not None and fused:
        pool = fused[: max(rerank_pool, limit)]
        passages = [passage_for(p) for p, _ in pool]
        try:
            logits = reranker.rerank(query, passages)
            order = sorted(range(len(pool)), key=lambda i: logits[i], reverse=True)
            ranked = [(pool[i][0], pool[i][1], float(logits[i])) for i in order]
            if rerank_margin is not None and ranked:
                cutoff = ranked[0][2] - rerank_margin
                ranked = [t for t in ranked if t[2] >= cutoff]
            rerank_scores = {p: lg for p, _, lg in ranked}
            fused = [(p, s) for p, s, _ in ranked][:limit]
        except Exception:
            # Reranker unavailable (model download/runtime failure) — search must
            # never break, only un-rerank: keep the fused order.
            fused = fused[:limit]
    elif mmr and fused:
        items = [(p, best_chunk[p].ordinal) for p, _ in fused if p in best_chunk]
        chunk_vecs = _chunk_vecs(vault, embedder.name, items)
        fused = _mmr_order(fused, chunk_vecs, mmr_lambda, limit)
    else:
        fused = fused[:limit]

    # Final invariant (defense in depth, cheap): every candidate source above was
    # already cut by section, so this is normally a no-op — but it guarantees no
    # rerank/mmr/usage stage can ever resurrect a wrong-section path into the result.
    if section is not None:
        fused = [(p, s) for p, s in fused if in_section(p, section)]

    out: list[HybridHit] = []
    for path, score in fused:
        ch = best_chunk.get(path)
        if ch is not None:
            heading, snippet = ch.heading, ch.text
            if passage_window > 0:
                expanded = _expanded_passage(vault, embedder.name, path, ch.ordinal, passage_window)
                if expanded:
                    snippet = expanded
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
                rerank_scores.get(path),
            )
        )
    return out

"""The vault's ``[[wikilink]]`` graph as a retrieval signal (ADR-0019).

A vault is a knowledge graph: notes are nodes, ``[[wikilinks]]`` are directed
edges. ``audit.py`` already parses these links — but only to flag *broken* ones.
This module turns the same graph into a **ranking signal**: given the strongest
lexical/semantic hits for a query, it expands one hop along the link graph (both
out-links and back-links) so a note that is *connected* to a strong hit can
surface even when it barely matches the query text on its own.

Why it helps here specifically: this kit's vault is densely interlinked
(``PROJECTS ↔ STACKS ↔ PRACTICES ↔ RULES``), so "errors handling SQLite in the
inventory app" should pull ``STACKS/sqlite.md`` because the strong hit
``PROJECTS/app-ap-sport-inv.md`` links straight to it. The expansion feeds a
third ranking into the existing Reciprocal Rank Fusion (``query.py``), where the
``1/(k+rank)`` damping keeps it a gentle nudge — it cannot dominate or dilute the
precision of BM25 + cosine.

Pure stdlib, read-only. The graph is parsed on demand from the ``vault_fts``
bodies that the indexer already keeps fresh — so there is no separate edge table
to maintain or backfill, and the graph can never go stale relative to the notes
(O(N) per query, the same order as the existing brute-force cosine; a persisted
adjacency table is the obvious scale-up, see ADR-0019).
"""

from __future__ import annotations

import re
import sqlite3
from collections import defaultdict

from .text_scrub import strip_code_regions

# [[target]] / [[target|alias]] / [[target#section]] — capture only the inner text.
# Mirrors audit._WIKILINK_RE so both see the exact same edges.
WIKILINK_RE = re.compile(r"\[\[([^\[\]]+?)\]\]")


def normalize_target(raw: str) -> str:
    """Normalize a raw ``[[...]]`` inner text to a resolution key.

    Drops a ``|alias`` label and a ``#section`` anchor, a trailing ``.md``, and
    lowercases to a posix, extension-less form. ``[[Note#Heading|Label]]`` ->
    ``"note"``; ``[[PROJECTS/foo.md]]`` -> ``"projects/foo"``. Returns ``""`` when
    the link is empty (e.g. ``[[#only-an-anchor]]``).
    """
    target = raw.split("|", 1)[0]  # drop display alias
    target = target.split("#", 1)[0]  # drop section anchor
    target = target.strip()
    if target.lower().endswith(".md"):
        target = target[:-3]
    return target.replace("\\", "/").strip().strip("/").lower()


def extract_targets(text: str) -> list[str]:
    """Distinct normalized wikilink targets in a note (first-seen order).

    Ignores ``[[...]]`` occurrences inside fenced code blocks or inline code spans
    (documentation examples of the syntax itself), which are not real edges.
    """
    seen: dict[str, None] = {}
    for match in WIKILINK_RE.finditer(strip_code_regions(text)):
        target = normalize_target(match.group(1))
        if target and target not in seen:
            seen[target] = None
    return list(seen)


def _build_resolver(paths: list[str]):
    """Return ``target -> relpath | None`` for the vault's known note paths.

    Resolves like Obsidian: a path-qualified link (``projects/foo``) matches the
    full relpath first; a bare link (``foo``) matches by basename. Ambiguous
    basenames resolve deterministically (lexicographically first) — graph
    expansion is only a soft boost, so a rare wrong pick cannot break a result.
    """
    by_relpath: dict[str, str] = {}
    by_basename: dict[str, list[str]] = defaultdict(list)
    for path in paths:
        key = path[:-3] if path.lower().endswith(".md") else path
        key = key.lower()
        by_relpath[key] = path
        by_basename[key.rsplit("/", 1)[-1]].append(path)

    def resolve(target: str) -> str | None:
        if target in by_relpath:
            return by_relpath[target]
        candidates = by_basename.get(target.rsplit("/", 1)[-1])
        return sorted(candidates)[0] if candidates else None

    return resolve


# Verb weights for type-weighted graph recall (ADR-0027). A strong structural
# relation (a note that *supersedes* or *implements* a seed) is a far better
# recall signal than a bare mention, so it scores higher than the default
# untyped `relates_to` edge. These modulate the score *within* the graph ranking;
# the whole graph ranking still enters the hybrid RRF at the small `GRAPH_WEIGHT`
# (query.py), so type weighting sharpens which neighbours surface without letting
# the link signal outvote BM25 + cosine. Tuned on the typed-multi golden bucket.
TYPED_RELATION_WEIGHTS: dict[str, float] = {
    "supersedes": 1.0,
    "superseded_by": 1.0,
    "implements": 0.8,
    "implemented_by": 0.8,
    "extends": 0.7,
    "part_of": 0.7,
    "depends_on": 0.6,
    "uses": 0.5,
    "see_also": 0.4,
    "relates_to": 0.3,
}
DEFAULT_RELATION_WEIGHT = 0.3


def _fts_paths(conn: sqlite3.Connection) -> list[str]:
    return [str(r["path"]) for r in conn.execute("SELECT path FROM vault_fts").fetchall()]


def typed_neighbor_paths(
    conn: sqlite3.Connection,
    seeds: list[str],
    *,
    limit: int = 50,
    weights: dict[str, float] | None = None,
) -> list[str]:
    """Rank notes one hop from ``seeds`` using the *typed* relations table (ADR-0027).

    Same both-directions, one-hop expansion as :func:`neighbor_paths`, but each edge
    contributes its verb weight (``supersedes`` > ``implements`` > … > ``relates_to``)
    instead of a flat +1, so a structurally-significant neighbour outranks a note that
    merely mentions a seed. Reads the persisted ``relations`` table (populated by the
    indexer from ``- <verb> [[target]]`` list items); targets are resolved to real
    paths at query time. Returns ``[]`` when there is no index or no relation rows, so
    it degrades exactly like the untyped path.
    """
    weight_for = weights or TYPED_RELATION_WEIGHTS
    seeds = list(dict.fromkeys(seeds))
    if not seeds:
        return []
    seed_set = set(seeds)
    try:
        rows = conn.execute(
            "SELECT source_path, relation_type, target FROM relations"
        ).fetchall()
    except sqlite3.OperationalError:  # relations table absent (pre-v2 index)
        return []
    if not rows:
        return []
    resolve = _build_resolver(_fts_paths(conn))

    score: dict[str, float] = defaultdict(float)
    for r in rows:
        src = str(r["source_path"])
        rtype = str(r["relation_type"])
        w = weight_for.get(rtype, DEFAULT_RELATION_WEIGHT)
        dst = resolve(str(r["target"]))
        if dst is None:
            continue
        if src in seed_set:
            if dst != src:
                score[dst] += w  # out-edge from a seed
        elif dst in seed_set:
            score[src] += w  # back-edge into the seed set

    ranked = sorted(score.items(), key=lambda kv: (-kv[1], kv[0]))
    return [path for path, _ in ranked[:limit]]


def neighbor_paths(
    conn: sqlite3.Connection, seeds: list[str], *, limit: int = 50
) -> list[str]:
    """Rank notes one hop from ``seeds`` in the link graph (best first).

    A note scores +1 for each distinct seed it is adjacent to, counting both
    directions (a seed's out-link, and any note whose link resolves *to* a seed).
    A note is *not* disqualified for also being a weak hit itself — promoting a
    weakly-matching but strongly-linked note into the visible top-K is the whole
    point — only self-links are skipped. Ties break by path for stable output.
    Returns ``[]`` when the index is empty or no seed has edges, so graph-aware
    search degrades cleanly to plain BM25 + cosine.

    Reads ``(path, title, body)`` straight from the FTS index, so the graph it
    sees is exactly the current note contents (no stale edge cache).
    """
    seeds = list(dict.fromkeys(seeds))
    if not seeds:
        return []
    seed_set = set(seeds)

    rows = conn.execute("SELECT path, title, body FROM vault_fts").fetchall()
    if not rows:
        return []
    resolve = _build_resolver([str(r["path"]) for r in rows])

    score: dict[str, int] = defaultdict(int)
    for r in rows:
        src = str(r["path"])
        text = f"{r['title'] or ''}\n{r['body'] or ''}"
        resolved = {dst for dst in (resolve(t) for t in extract_targets(text)) if dst}
        if not resolved:
            continue
        if src in seed_set:
            for dst in resolved:  # out-edges from a seed
                if dst != src:
                    score[dst] += 1
        else:
            pointed_seeds = resolved & seed_set  # back-edges into the seed set
            if pointed_seeds:
                score[src] += len(pointed_seeds)

    ranked = sorted(score.items(), key=lambda kv: (-kv[1], kv[0]))
    return [path for path, _ in ranked[:limit]]

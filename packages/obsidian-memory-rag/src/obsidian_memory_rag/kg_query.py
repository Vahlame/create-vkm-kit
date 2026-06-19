"""Query the structured knowledge graph: typed relations + observations (ADR-0023).

The indexer persists each note's relations and observations into ``fts.sqlite``
(see :mod:`.knowledge_graph` and :mod:`.indexer`). This module reads them back as
answerable questions the flat retrieval path cannot express:

- :func:`relations_for` — an entity's typed edges, **both directions** ("what does
  this note implement?" / "what supersedes it?"). Targets are resolved to real note
  paths at query time using the same Obsidian-style resolver as graph retrieval, so
  a sibling note appearing later never leaves a stale ``target_path``.
- :func:`observations_query` — structured facts filtered by category, ``#tag`` and/or
  source note ("all ``[gotcha]`` observations", "everything tagged ``#ranking``").
- :func:`suggest_structure` — a **read-only** assistant that shows what is already
  structured in a note and proposes typing/observation candidates from its prose. It
  never writes (mirrors ``memory_extract_candidates``): the agent confirms and edits.

All read-only, pure stdlib.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .graphlink import WIKILINK_RE, _build_resolver, normalize_target
from .knowledge_graph import (
    RELATES_TO,
    _OBSERVATION_RE,
    _TYPED_REL_RE,
    parse_observations,
    parse_relations,
)
from .markdown_io import read_note
from .paths import index_db_path
from .store import connect, init_schema


@dataclass
class RelationHit:
    source_path: str
    relation_type: str
    target: str  # normalized wikilink key
    target_path: str | None  # resolved note path, or None when the target is missing
    context: str
    direction: str  # "out" (source -> note's target) | "in" (another note -> this one)


@dataclass
class ObservationHit:
    source_path: str
    category: str
    content: str
    tags: list[str] = field(default_factory=list)


def _all_paths(conn) -> list[str]:
    return [str(r["path"]) for r in conn.execute("SELECT path FROM vault_fts").fetchall()]


def _open(vault: Path):
    """Return an initialized connection, or ``None`` if no index exists yet."""
    db_path = index_db_path(vault.resolve())
    if not db_path.is_file():
        return None
    conn = connect(db_path)
    init_schema(conn)
    return conn


def relations_for(
    vault: Path, note: str, *, direction: str = "both", limit: int = 200
) -> list[RelationHit]:
    """Typed relations touching ``note``. ``direction`` is ``out`` | ``in`` | ``both``.

    ``note`` may be a path (``PROJECTS/foo.md``) or a bare name (``foo``); it is
    resolved Obsidian-style. Outgoing edges come from this note; incoming edges are
    any note whose relation target resolves to this one. Returns ``[]`` when the
    index is missing or the note is unknown.
    """
    vault = vault.resolve()
    conn = _open(vault)
    if conn is None:
        return []
    try:
        resolve = _build_resolver(_all_paths(conn))
        note_path = resolve(normalize_target(note))
        if not note_path:
            return []
        hits: list[RelationHit] = []
        if direction in ("out", "both"):
            rows = conn.execute(
                "SELECT relation_type, target, context FROM relations "
                "WHERE source_path = ? ORDER BY relation_type, target",
                (note_path,),
            ).fetchall()
            for r in rows:
                hits.append(
                    RelationHit(
                        note_path,
                        str(r["relation_type"]),
                        str(r["target"]),
                        resolve(str(r["target"])),
                        str(r["context"] or ""),
                        "out",
                    )
                )
        if direction in ("in", "both"):
            rows = conn.execute(
                "SELECT source_path, relation_type, target, context FROM relations "
                "ORDER BY source_path, relation_type, target"
            ).fetchall()
            for r in rows:
                src = str(r["source_path"])
                if src == note_path:
                    continue
                if resolve(str(r["target"])) == note_path:
                    hits.append(
                        RelationHit(
                            src,
                            str(r["relation_type"]),
                            str(r["target"]),
                            note_path,
                            str(r["context"] or ""),
                            "in",
                        )
                    )
        return hits[:limit]
    finally:
        conn.close()


def observations_query(
    vault: Path,
    *,
    category: str | None = None,
    tag: str | None = None,
    note: str | None = None,
    limit: int = 200,
) -> list[ObservationHit]:
    """Structured observations filtered by ``category`` / ``tag`` / ``note`` (any combo).

    ``category`` matches exactly (case-insensitive). ``tag`` matches one whole
    ``#tag`` (without the ``#``). ``note`` restricts to a single source note,
    resolved Obsidian-style. Returns ``[]`` when no index exists.
    """
    vault = vault.resolve()
    conn = _open(vault)
    if conn is None:
        return []
    try:
        where: list[str] = []
        params: list[object] = []
        if category:
            where.append("category = ?")
            params.append(category.strip().lower())
        if note:
            resolve = _build_resolver(_all_paths(conn))
            note_path = resolve(normalize_target(note))
            if not note_path:
                return []
            where.append("source_path = ?")
            params.append(note_path)
        if tag:
            # Exact whole-tag match via sentinel-padded LIKE (avoids substring hits).
            where.append("(' ' || tags || ' ') LIKE ?")
            params.append(f"% {tag.strip().lower().lstrip('#')} %")
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        params.append(limit)
        rows = conn.execute(
            "SELECT source_path, category, content, tags FROM observations"
            f"{clause} ORDER BY source_path, ordinal LIMIT ?",
            params,
        ).fetchall()
        return [
            ObservationHit(
                str(r["source_path"]),
                str(r["category"]),
                str(r["content"]),
                str(r["tags"] or "").split(),
            )
            for r in rows
        ]
    finally:
        conn.close()


# A plain prose list item — has list-item shape but is neither a typed relation nor
# an observation. These are the lines suggest_structure offers to promote.
_PLAIN_BULLET_RE = re.compile(r"^\s*[-*+]\s+(?P<text>\S.*)$")


def suggest_structure(vault: Path, note: str, *, max_each: int = 8) -> dict:
    """Read-only: show a note's existing structure + candidates to add. Never writes.

    Returns a JSON-serializable dict with the note's parsed ``relations`` and
    ``observations`` plus two suggestion lists: ``untyped_links`` (``relates_to``
    edges that could be given a specific verb) and ``observation_candidates`` (plain
    prose bullets that read like facts and could become ``- [category] …`` lines).
    The agent reviews these and edits the note itself — this tool proposes only.
    """
    vault = vault.resolve()
    conn = _open(vault)
    note_path = note
    if conn is not None:
        try:
            resolved = _build_resolver(_all_paths(conn))(normalize_target(note))
            if resolved:
                note_path = resolved
        finally:
            conn.close()

    fp = vault / Path(note_path)
    if not fp.is_file():
        return {
            "note": note_path,
            "error": "note not found in vault",
            "relations": [],
            "observations": [],
            "untyped_links": [],
            "observation_candidates": [],
        }

    title, body = read_note(fp, 1_048_576)
    text = f"{title}\n{body}"
    relations = parse_relations(text)
    observations = parse_observations(body)

    untyped = [r.target for r in relations if r.relation_type == RELATES_TO][:max_each]

    candidates: list[str] = []
    for line in body.splitlines():
        if _TYPED_REL_RE.match(line) or _OBSERVATION_RE.match(line):
            continue
        m = _PLAIN_BULLET_RE.match(line)
        if not m:
            continue
        snippet = m.group("text").strip()
        # Only bullets with enough substance to be a real fact, and not just a
        # bare wikilink (those are already relations).
        if len(snippet.split()) >= 4 and not WIKILINK_RE.fullmatch(snippet.strip("[] ")):
            candidates.append(snippet)
        if len(candidates) >= max_each:
            break

    return {
        "note": note_path,
        "relations": [
            {"relation_type": r.relation_type, "target": r.target, "context": r.context}
            for r in relations
        ],
        "observations": [
            {"category": o.category, "content": o.content, "tags": list(o.tags)}
            for o in observations
        ],
        "untyped_links": untyped,
        "observation_candidates": candidates,
        "notice": (
            "Suggestions only — never written automatically. To add structure, edit "
            "the note: type a relation as '- <verb> [[target]]' (e.g. '- implements "
            "[[adr-0014]]') or state a fact as '- [category] content #tag'."
        ),
    }

"""FTS5 search with BM25 ranking."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .paths import index_db_path
from .store import connect, init_schema


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

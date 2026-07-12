"""Memory report: a read-only digest of vault state for hygiene + compaction (ADR-0024).

"Periodically condense old notes, detect contradictions, build automatic indices and
memory reports" is the ask. This module is the **deterministic substrate** for all of
it — a single read-only aggregation that composes what the kit already indexes:

- **Automatic indices:** observations grouped by category, relations by type, the most
  inline ``#tags``, and the graph's **hub notes** (highest link degree) — a map of what
  the vault knows and how it connects, with no manual upkeep.
- **Hygiene / compaction candidates:** oversized notes, broken ``[[wikilinks]]`` and
  ``SESSION_LOG`` bloat (from :mod:`.audit`), plus **stale notes** (untouched for a long
  time) and **orphan notes** (no relations in or out). These are what an agent would
  *condense* — but the engine only flags them; the agent summarizes and the human
  confirms (writes go through the normal edit tools / ``rotate-log``). The vault is the
  user's; nothing here rewrites a note.
- **Review candidates (contradictions/redundancy):** with embeddings present, the most
  similar **note pairs** and **observation pairs** by cosine. Honest framing — these are
  *candidates to review*, not a claim of semantic contradiction detection (true NLI is
  out of scope for a stdlib engine). A human (or the agent) judges whether a near-dup
  pair is redundant, contradictory, or fine.

Pure stdlib; the duplicate-pair section is the only part that needs vectors and is
opt-in. JSON-serializable verbatim so the Node MCP bridge forwards it untouched.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path

from .audit import audit_vault
from .graphlink import _build_resolver, normalize_target
from .paths import index_db_path
from .store import connect, init_schema
from .vector_store import _from_blob, has_any_chunks

_NS_PER_DAY = 86_400 * 1_000_000_000


def _all_paths(conn) -> list[str]:
    return [str(r["path"]) for r in conn.execute("SELECT path FROM vault_fts").fetchall()]


def _category_index(conn) -> list[dict]:
    rows = conn.execute(
        "SELECT category, COUNT(*) AS n FROM observations GROUP BY category ORDER BY n DESC, category"
    ).fetchall()
    return [{"category": str(r["category"]), "count": int(r["n"])} for r in rows]


def _relation_index(conn) -> list[dict]:
    rows = conn.execute(
        "SELECT relation_type, COUNT(*) AS n FROM relations "
        "GROUP BY relation_type ORDER BY n DESC, relation_type"
    ).fetchall()
    return [{"relation_type": str(r["relation_type"]), "count": int(r["n"])} for r in rows]


def _tag_index(conn, *, limit: int = 25) -> list[dict]:
    counts: dict[str, int] = {}
    for r in conn.execute("SELECT tags FROM observations WHERE tags <> ''").fetchall():
        for tag in str(r["tags"]).split():
            counts[tag] = counts.get(tag, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [{"tag": t, "count": n} for t, n in ranked[:limit]]


def _degree(conn) -> tuple[dict[str, int], dict[str, int]]:
    """Return (out_degree, in_degree) per note path from the relations table."""
    paths = _all_paths(conn)
    resolve = _build_resolver(paths)
    out_deg: dict[str, int] = {}
    in_deg: dict[str, int] = {}
    rows = conn.execute("SELECT source_path, target FROM relations").fetchall()
    for r in rows:
        src = str(r["source_path"])
        out_deg[src] = out_deg.get(src, 0) + 1
        dst = resolve(normalize_target(str(r["target"])))
        if dst and dst != src:
            in_deg[dst] = in_deg.get(dst, 0) + 1
    return out_deg, in_deg


def _hub_notes(out_deg, in_deg, *, limit: int = 10) -> list[dict]:
    paths = set(out_deg) | set(in_deg)
    ranked = sorted(
        paths,
        key=lambda p: (-(out_deg.get(p, 0) + in_deg.get(p, 0)), p),
    )
    return [
        {
            "path": p,
            "degree": out_deg.get(p, 0) + in_deg.get(p, 0),
            "out": out_deg.get(p, 0),
            "in": in_deg.get(p, 0),
        }
        for p in ranked[:limit]
    ]


def _stale_notes(conn, *, stale_days: float, limit: int = 20) -> list[dict]:
    now = time.time_ns()
    rows = conn.execute("SELECT path, mtime_ns FROM vault_fts").fetchall()
    out: list[dict] = []
    for r in rows:
        mtime = int(r["mtime_ns"])
        age = max(0.0, (now - mtime) / _NS_PER_DAY)
        if age >= stale_days:
            out.append({"path": str(r["path"]), "age_days": round(age, 1)})
    out.sort(key=lambda d: -d["age_days"])
    return out[:limit]


def _orphan_notes(conn, out_deg, in_deg, *, limit: int = 20) -> list[str]:
    """Notes with no relation in or out — disconnected from the graph."""
    connected = set(out_deg) | set(in_deg)
    orphans = sorted(p for p in _all_paths(conn) if p not in connected)
    return orphans[:limit]


def _note_vectors(conn, embedder_name: str) -> dict[str, list[float]]:
    """Mean (L2-normalized) chunk vector per note, for the given embedder."""
    import math

    sums: dict[str, list[float]] = {}
    counts: dict[str, int] = {}
    rows = conn.execute(
        "SELECT path, vec FROM note_chunks WHERE embedder = ?", (embedder_name,)
    ).fetchall()
    for r in rows:
        vec = _from_blob(r["vec"])
        p = str(r["path"])
        acc = sums.get(p)
        if acc is None:
            sums[p] = list(vec)
        else:
            for i, x in enumerate(vec):
                acc[i] += x
        counts[p] = counts.get(p, 0) + 1
    out: dict[str, list[float]] = {}
    for p, acc in sums.items():
        norm = math.sqrt(math.fsum(x * x for x in acc))
        out[p] = [x / norm for x in acc] if norm > 0 else acc
    return out


@dataclass
class NearDuplicateScan:
    """Result of :func:`_near_duplicate_notes`.

    ``pairs`` alone is ambiguous above the size cap: a bare ``[]`` could mean
    "ran the scan, found nothing" or "skipped the scan entirely" and a caller
    (or a human reading ``memory-report``/``memory-reflect`` output) cannot
    tell those apart. ``truncated``/``note_count`` make the "skipped for size"
    case an explicit, checkable signal instead.
    """

    pairs: list[dict] = field(default_factory=list)
    truncated: bool = False
    note_count: int = 0


def _near_duplicate_notes(
    conn, embedder_name: str, *, similarity: float, max_pairs: int, max_notes: int
) -> NearDuplicateScan:
    """Note pairs whose mean-vector cosine >= ``similarity`` (best first).

    Above ``max_notes`` the O(n^2) pairwise cosine scan is skipped to keep this
    cheap on large vaults; ``NearDuplicateScan.truncated`` signals that case
    explicitly rather than returning an empty-looking result.
    """
    import math

    vecs = _note_vectors(conn, embedder_name)
    paths = sorted(vecs)
    if len(paths) > max_notes:  # guard the O(n^2) scan on very large vaults
        return NearDuplicateScan(pairs=[], truncated=True, note_count=len(paths))
    pairs: list[dict] = []
    for i in range(len(paths)):
        vi = vecs[paths[i]]
        for j in range(i + 1, len(paths)):
            vj = vecs[paths[j]]
            if len(vi) != len(vj):
                continue
            cos = math.fsum(a * b for a, b in zip(vi, vj))
            if cos >= similarity:
                pairs.append({"a": paths[i], "b": paths[j], "similarity": round(cos, 4)})
    pairs.sort(key=lambda d: -d["similarity"])
    return NearDuplicateScan(pairs=pairs[:max_pairs], truncated=False, note_count=len(paths))


def build_report(
    vault: Path,
    *,
    budget_tokens: int = 8000,
    stale_days: float = 180.0,
    similarity: float = 0.92,
    duplicates: bool = False,
    max_pairs: int = 20,
    max_notes_for_pairs: int = 1500,
    embedder_name: str | None = None,
) -> dict:
    """Build a read-only memory report. Returns a JSON-serializable dict.

    ``duplicates=True`` adds near-duplicate note pairs (needs embeddings; no-op
    without them). The note-pair scan is skipped above ``max_notes_for_pairs`` to
    keep it cheap on large vaults. Pass ``embedder_name`` (from a preceding
    ``ensure_fresh(...).embedder_name``) to filter ``note_chunks`` by the
    identity that ACTUALLY built the index — omitting it falls back to
    ``resolve_embedder_name(None)``, which can silently disagree with a vault
    indexed under a non-default embedder and see zero rows.
    """
    vault = vault.resolve()
    audit = audit_vault(vault, budget_tokens=budget_tokens)

    db_path = index_db_path(vault)
    indices: dict = {
        "observations_by_category": [],
        "relations_by_type": [],
        "top_tags": [],
        "hub_notes": [],
    }
    totals = {
        "notes": audit["totals"]["notes"],
        "tokens": audit["totals"]["tokens"],
        "relations": 0,
        "observations": 0,
    }
    hygiene: dict = {
        "oversized": audit["oversized"],
        "oversized_total": audit.get("oversized_total", len(audit["oversized"])),
        "broken_links": audit["broken_links"],
        "broken_links_total": audit.get("broken_links_total", len(audit["broken_links"])),
        "session_log": audit["session_log"],
        "stale_notes": [],
        "orphan_notes": [],
        "cold_notes": [],
    }
    review_candidates: dict = {"near_duplicate_notes": []}

    if db_path.is_file():
        conn = connect(db_path)
        try:
            init_schema(conn)
            totals["relations"] = int(
                conn.execute("SELECT COUNT(*) AS n FROM relations").fetchone()["n"]
            )
            totals["observations"] = int(
                conn.execute("SELECT COUNT(*) AS n FROM observations").fetchone()["n"]
            )
            indices["observations_by_category"] = _category_index(conn)
            indices["relations_by_type"] = _relation_index(conn)
            indices["top_tags"] = _tag_index(conn)
            out_deg, in_deg = _degree(conn)
            indices["hub_notes"] = _hub_notes(out_deg, in_deg)
            hygiene["stale_notes"] = _stale_notes(conn, stale_days=stale_days)
            hygiene["orphan_notes"] = _orphan_notes(conn, out_deg, in_deg)
            if duplicates and has_any_chunks(conn):
                if embedder_name is not None:
                    name = embedder_name
                else:
                    # No identity threaded in from a preceding ensure_fresh() call
                    # (e.g. called directly, as in tests) — best-effort fallback.
                    from .embeddings import resolve_embedder_name

                    name = resolve_embedder_name(None)
                dup_scan = _near_duplicate_notes(
                    conn,
                    name,
                    similarity=similarity,
                    max_pairs=max_pairs,
                    max_notes=max_notes_for_pairs,
                )
                review_candidates["near_duplicate_notes"] = dup_scan.pairs
                if dup_scan.truncated:
                    review_candidates["near_duplicate_notes_skipped_reason"] = (
                        f"skipped: {dup_scan.note_count} notes exceed max_notes_for_pairs "
                        f"({max_notes_for_pairs}); raise the cap or narrow the vault to scan"
                    )
        finally:
            conn.close()
        # Cold notes (ADR-0038): indexed for a while, never returned by a search
        # nor opened by the agent — the decay side of the usage loop. Opens its
        # own connection internally; [] when no recall telemetry exists at all
        # (absence of data is not evidence of disuse).
        from .recall_log import cold_notes

        hygiene["cold_notes"] = cold_notes(vault)

    suggestions = _suggestions(totals, hygiene, review_candidates)

    return {
        "vault": str(vault),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "budget_tokens": budget_tokens,
        "stale_days": stale_days,
        "totals": totals,
        "indices": indices,
        "hygiene": hygiene,
        "review_candidates": review_candidates,
        "suggested_actions": suggestions,
        "notice": (
            "Read-only report. Compaction/condensing candidates are proposals — the "
            "agent summarizes and the human confirms; nothing here rewrites a note. "
            "Near-duplicate pairs are candidates to review, not confirmed contradictions. "
            "When condensing, compress prose only: never drop decisions, gotchas, "
            "commands, or exact error strings (ADR-0032)."
        ),
    }


def _suggestions(totals, hygiene, review_candidates) -> list[str]:
    out: list[str] = []
    sl = hygiene.get("session_log")
    if sl and sl.get("over_threshold"):
        out.append(
            f"SESSION_LOG.md is over budget ({sl['tokens']} tokens) — run `rotate-log` "
            "to archive old sections."
        )
    oversized = hygiene.get("oversized") or []
    if oversized:
        worst = oversized[0]
        out.append(
            f"{len(oversized)} note(s) over the token budget (largest: {worst['path']}, "
            f"{worst['tokens']} tokens) — consider splitting or condensing."
        )
    broken = hygiene.get("broken_links") or []
    if broken:
        out.append(f"{len(broken)} broken [[wikilink]](s) — fix or remove the dangling targets.")
    orphans = hygiene.get("orphan_notes") or []
    if orphans:
        out.append(
            f"{len(orphans)} orphan note(s) with no relations — link them so retrieval and "
            "the graph can reach them."
        )
    stale = hygiene.get("stale_notes") or []
    if stale:
        out.append(
            f"{len(stale)} stale note(s) (oldest: {stale[0]['path']}, {stale[0]['age_days']}d) — "
            "review whether they are still accurate or should be condensed/archived."
        )
    cold = hygiene.get("cold_notes") or []
    if cold:
        out.append(
            f"{len(cold)} cold note(s) never returned by a search nor opened "
            f"(e.g. {cold[0]['path']}) — review for archiving with `memory-reflect`."
        )
    dupes = review_candidates.get("near_duplicate_notes") or []
    if dupes:
        out.append(
            f"{len(dupes)} near-duplicate note pair(s) — review for redundancy or contradiction "
            "(e.g. {} ↔ {}).".format(dupes[0]["a"], dupes[0]["b"])
        )
    skipped_reason = review_candidates.get("near_duplicate_notes_skipped_reason")
    if skipped_reason:
        out.append(f"Near-duplicate scan {skipped_reason} — no duplicate signal for this run.")
    if not out:
        out.append("No hygiene issues found — the vault is in good shape.")
    return out

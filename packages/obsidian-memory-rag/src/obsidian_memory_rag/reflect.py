"""Reflection: read-only consolidation proposals for the evolutive loop (ADR-0038).

The rules block *describes* a promotion pipeline — observations logged with
``status: pending`` graduate to ``PRACTICES/confirmed-{good,bad}.md`` when the
human confirms, hypotheses become facts, stale notes get archived, near-dups
merged — but nothing in the kit *drives* it. This module closes that gap the
same way ``vault_memory_report`` handles hygiene (ADR-0024): a deterministic,
stdlib-only generator of **proposals** with a ``proposed_action`` per item.
Nothing here writes to a note the agent hasn't been told to write by a human;
the only write surface is the CLI's explicit ``--write-note``, which renders
the proposals themselves into a dated ``_meta/reflection-YYYY-MM-DD.md`` for
review (same human-invoked precedent as ``rotate-log``).

Sections:

- **promotions** — ``PRACTICES/observations.md`` lines still ``status: pending``
  after ``since_days`` (the ``date · file:line · pattern · status: pending``
  format the rules block teaches) → propose confirm-or-dismiss.
- **merges** — near-duplicate note pairs by mean-chunk cosine (reuses
  :func:`report._near_duplicate_notes`; needs embeddings, auto-skipped without).
- **decay** — stale notes that are *explicitly hypotheses* (frontmatter
  ``status: hypothesis``) → propose verify-or-archive; plus graph orphans →
  propose linking. Confirmed/undated notes are never proposed for archive.
- **recent_activity** — the newest ``SESSION_LOG.md`` sections digested into
  top ``#tags`` / ``[[wikilinks]]`` counts (stdlib counting, no ML): what the
  vault has actually been about lately, to steer what deserves promotion.
"""

from __future__ import annotations

import re
import time
from collections import Counter
from pathlib import Path

from .paths import index_db_path
from .report import _degree, _near_duplicate_notes, _orphan_notes, _stale_notes
from .rotate import _split_sections
from .store import connect, init_schema
from .text_scrub import strip_code_regions
from .vector_store import has_any_chunks

_PENDING_RE = re.compile(
    r"^(?P<line>\s*[-*]?\s*(?P<date>\d{4}-\d{2}-\d{2})\s*·.*status:\s*pending.*)$",
    re.MULTILINE,
)
_FRONTMATTER_RE = re.compile(r"^---\r?\n(.*?)\r?\n---(?:\r?\n|$)", re.DOTALL)
_STATUS_HYPOTHESIS_RE = re.compile(r"^status:\s*hypothesis\b", re.MULTILINE)
_TAG_RE = re.compile(r"(?<!\w)#([\w][\w/-]*)")
_WIKILINK_RE = re.compile(r"\[\[([^\[\]|#]+)")

OBSERVATIONS_NOTE = "PRACTICES/observations.md"
SESSION_LOG_NAME = "SESSION_LOG.md"

_SECONDS_PER_DAY = 86_400


def _pending_promotions(vault: Path, *, since_days: float, now: float) -> list[dict]:
    fp = vault / OBSERVATIONS_NOTE
    if not fp.is_file():
        return []
    try:
        text = fp.read_text(encoding="utf-8-sig")
    except OSError:
        return []
    # A fenced example of the "date · file:line · pattern · status: pending"
    # format (documenting the syntax itself, e.g. in this note's own header)
    # must not be proposed as a real promotion candidate.
    text = strip_code_regions(text)
    out: list[dict] = []
    for m in _PENDING_RE.finditer(text):
        try:
            logged = time.mktime(time.strptime(m.group("date"), "%Y-%m-%d"))
        except ValueError:
            continue
        age_days = max(0.0, (now - logged) / _SECONDS_PER_DAY)
        if age_days >= since_days:
            out.append(
                {
                    "line": m.group("line").strip(),
                    "age_days": round(age_days, 1),
                    "target_path": OBSERVATIONS_NOTE,
                    "proposed_action": (
                        "ask the human: confirm → move to PRACTICES/confirmed-{good,bad}.md; "
                        "dismiss → mark status: dismissed"
                    ),
                }
            )
    return out


def _is_hypothesis(vault: Path, rel: str) -> bool:
    fp = vault / rel
    try:
        text = fp.read_text(encoding="utf-8-sig")
    except OSError:
        return False
    m = _FRONTMATTER_RE.match(text)
    return bool(m and _STATUS_HYPOTHESIS_RE.search(m.group(1)))


def _recent_activity(vault: Path, *, sections: int = 15) -> dict:
    fp = vault / SESSION_LOG_NAME
    if not fp.is_file():
        return {"sections": 0, "top_tags": [], "top_links": []}
    try:
        text = fp.read_text(encoding="utf-8-sig")
    except OSError:
        return {"sections": 0, "top_tags": [], "top_links": []}
    _, secs = _split_sections(text)
    newest = secs[-sections:]
    tags: Counter[str] = Counter()
    links: Counter[str] = Counter()
    for s in newest:
        # A section documenting the #tag/[[wikilink]] syntax in a fenced example
        # must not pollute the real usage counts below.
        scan = strip_code_regions(s)
        tags.update(t.lower() for t in _TAG_RE.findall(scan))
        links.update(t.strip().lower() for t in _WIKILINK_RE.findall(scan))
    return {
        "sections": len(newest),
        "top_tags": [{"tag": t, "count": n} for t, n in tags.most_common(8)],
        "top_links": [{"target": t, "count": n} for t, n in links.most_common(8)],
    }


def build_reflection(
    vault: Path,
    *,
    since_days: float = 14.0,
    stale_days: float = 180.0,
    similarity: float = 0.92,
    max_pairs: int = 20,
    max_notes_for_pairs: int = 1500,
    embedder_name: str | None = None,
) -> dict:
    """Build the reflection proposal set. Read-only, JSON-serializable.

    Pass ``embedder_name`` (from a preceding ``ensure_fresh(...).embedder_name``)
    so the merge scan filters ``note_chunks`` by the identity that actually built
    the index — see :func:`report.build_report`'s matching parameter.
    """
    vault = vault.resolve()
    now = time.time()

    promotions = _pending_promotions(vault, since_days=since_days, now=now)

    merges: list[dict] = []
    merges_skipped_reason: str | None = None
    decay: list[dict] = []
    db_path = index_db_path(vault)
    if db_path.is_file():
        conn = connect(db_path)
        try:
            init_schema(conn)
            if has_any_chunks(conn):
                if embedder_name is not None:
                    name = embedder_name
                else:
                    from .embeddings import resolve_embedder_name

                    name = resolve_embedder_name(None)
                dup_scan = _near_duplicate_notes(
                    conn,
                    name,
                    similarity=similarity,
                    max_pairs=max_pairs,
                    max_notes=max_notes_for_pairs,
                )
                merges = [
                    {
                        **pair,
                        "proposed_action": (
                            "review the pair; if redundant, merge into one note and leave a "
                            "[[wikilink]] stub (human confirms first)"
                        ),
                    }
                    for pair in dup_scan.pairs
                ]
                if dup_scan.truncated:
                    merges_skipped_reason = (
                        f"skipped: {dup_scan.note_count} notes exceed max_notes_for_pairs "
                        f"({max_notes_for_pairs}); raise the cap or narrow the vault to scan"
                    )
            stale = _stale_notes(conn, stale_days=stale_days)
            for item in stale:
                if _is_hypothesis(vault, item["path"]):
                    decay.append(
                        {
                            **item,
                            "reason": "stale hypothesis (frontmatter status: hypothesis)",
                            "proposed_action": (
                                "re-verify with the human: promote to status: confirmed, "
                                "update, or archive"
                            ),
                        }
                    )
            out_deg, in_deg = _degree(conn)
            for orphan in _orphan_notes(conn, out_deg, in_deg):
                decay.append(
                    {
                        "path": orphan,
                        "reason": "orphan (no relations in or out)",
                        "proposed_action": "link it from a hub note or fold it into one",
                    }
                )
        finally:
            conn.close()

    return {
        "vault": str(vault),
        "since_days": since_days,
        "stale_days": stale_days,
        "promotions": promotions,
        "merges": merges,
        "merges_skipped_reason": merges_skipped_reason,
        "decay": decay,
        "recent_activity": _recent_activity(vault),
        "notice": (
            "Proposals only — nothing has been applied. Show them to the human; apply "
            "approved ones via vault_edit_file (pass the read etag as ifMatch). "
            "Never auto-apply promotions, merges, or archives."
        ),
    }


def format_reflection(data: dict) -> str:
    """Render the reflection dict as a review note body (Markdown)."""
    lines = [
        "# Reflection — consolidation proposals",
        "",
        f"vault: {data['vault']}",
        "",
        "> Proposals only (ADR-0038). Confirm each with the human before applying.",
        "",
    ]
    if data["promotions"]:
        lines.append("## Pending promotions")
        lines.append("")
        for p in data["promotions"]:
            lines.append(f"- ({p['age_days']}d) {p['line']}")
            lines.append(f"  - → {p['proposed_action']}")
        lines.append("")
    if data["merges"] or data.get("merges_skipped_reason"):
        lines.append("## Merge candidates (near-duplicates)")
        lines.append("")
        for m in data["merges"]:
            lines.append(f"- {m['a']} ↔ {m['b']} (cos {m['similarity']})")
        if data.get("merges_skipped_reason"):
            lines.append(f"- _scan {data['merges_skipped_reason']}_")
        lines.append("")
    if data["decay"]:
        lines.append("## Decay / archive candidates")
        lines.append("")
        for d in data["decay"]:
            age = f", {d['age_days']}d" if "age_days" in d else ""
            lines.append(f"- {d['path']} ({d['reason']}{age})")
        lines.append("")
    ra = data["recent_activity"]
    lines.append("## Recent activity")
    lines.append("")
    lines.append(f"- sections digested: {ra['sections']}")
    if ra["top_tags"]:
        lines.append("- top tags: " + ", ".join(f"#{t['tag']}×{t['count']}" for t in ra["top_tags"]))
    if ra["top_links"]:
        lines.append(
            "- top links: " + ", ".join(f"[[{t['target']}]]×{t['count']}" for t in ra["top_links"])
        )
    if not (
        data["promotions"] or data["merges"] or data["decay"] or data.get("merges_skipped_reason")
    ):
        lines.append("")
        lines.append("Nothing to consolidate — the vault is in good shape.")
    lines.append("")
    return "\n".join(lines)


def write_reflection_note(vault: Path, data: dict, *, day: str | None = None) -> Path:
    """Write the rendered proposals to ``_meta/reflection-<day>.md`` (atomic,
    idempotent per day — re-running overwrites the same file, never appends)."""
    from .rotate import _atomic_write

    day = day or time.strftime("%Y-%m-%d")
    target = vault / "_meta" / f"reflection-{day}.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write(target, format_reflection(data))
    return target

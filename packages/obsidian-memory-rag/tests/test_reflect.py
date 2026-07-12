"""Reflection proposal generator (ADR-0038): deterministic fixtures, read-only."""

from __future__ import annotations

import os
import time
from pathlib import Path

from obsidian_memory_rag import HashingEmbedder, index_vault, index_vectors
from obsidian_memory_rag.reflect import (
    build_reflection,
    format_reflection,
    write_reflection_note,
)


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _age(path: Path, days: float) -> None:
    ts = time.time() - days * 86_400
    os.utime(path, (ts, ts))


def _old_date(days: float) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(time.time() - days * 86_400))


def test_pending_promotions_by_age(tmp_path: Path) -> None:
    vault = tmp_path / "v"
    _write(
        vault / "PRACTICES" / "observations.md",
        "# observations\n\n"
        f"- {_old_date(30)} · api.py:10 · SQL sin parametrizar · status: pending\n"
        f"- {_old_date(2)} · app.ts:5 · any en boundary · status: pending\n"
        f"- {_old_date(40)} · ok.py:1 · patrón confirmado · status: dismissed\n",
    )
    data = build_reflection(vault, since_days=14)
    lines = [p["line"] for p in data["promotions"]]
    assert len(lines) == 1
    assert "SQL sin parametrizar" in lines[0]
    assert data["promotions"][0]["age_days"] >= 29
    assert "confirm" in data["promotions"][0]["proposed_action"]


def test_decay_flags_only_stale_hypotheses_plus_orphans(tmp_path: Path) -> None:
    vault = tmp_path / "v"
    _write(
        vault / "STACKS" / "hypo.md",
        "---\nstatus: hypothesis\n---\n# hypo\n\nQuizá X causa Y.\n",
    )
    _write(vault / "STACKS" / "confirmed.md", "---\nstatus: confirmed\n---\n# ok\n\nHecho.\n")
    _write(vault / "PROJECTS" / "linked.md", "# linked\n\n- uses [[STACKS/hypo]]\n")
    index_vault(vault)
    # Both stale on mtime; only the hypothesis becomes a decay candidate.
    _age(vault / "STACKS" / "hypo.md", 400)
    _age(vault / "STACKS" / "confirmed.md", 400)
    index_vault(vault)  # re-index so mtimes land in the FTS table
    data = build_reflection(vault, stale_days=180)
    hypo_flagged = [d["path"] for d in data["decay"] if "hypothesis" in d["reason"]]
    # Only the explicit hypothesis is a stale-hypothesis candidate — a stale
    # confirmed note must never be proposed for archive on age alone.
    assert hypo_flagged == ["STACKS/hypo.md"]
    # confirmed.md has no relations either way → it may surface as an orphan
    # (a linking proposal), which is the only acceptable reason for it here.
    for d in data["decay"]:
        if d["path"] == "STACKS/confirmed.md":
            assert "orphan" in d["reason"]


def test_merge_candidates_from_near_duplicates(tmp_path: Path) -> None:
    vault = tmp_path / "v"
    body = "Pipeline ETL ingesta transformacion carga incremental.\n"
    _write(vault / "a.md", f"# a\n\n{body}")
    _write(vault / "b.md", f"# b\n\n{body}")
    _write(vault / "c.md", "# c\n\nTema totalmente distinto: recetas de cocina.\n")
    index_vault(vault)
    index_vectors(vault, HashingEmbedder(dim=256))
    data = build_reflection(vault, similarity=0.95)
    pairs = {(m["a"], m["b"]) for m in data["merges"]}
    assert ("a.md", "b.md") in pairs
    assert all("c.md" not in p for pair in pairs for p in pair)


def test_merges_truncated_signals_skip_not_silent_empty(tmp_path: Path) -> None:
    """Above max_notes_for_pairs the near-dup scan is skipped — build_reflection
    must say so (merges_skipped_reason), not just report an empty merges list
    indistinguishable from "no duplicates found"."""
    vault = tmp_path / "v"
    body = "Pipeline ETL ingesta transformacion carga incremental.\n"
    _write(vault / "a.md", f"# a\n\n{body}")
    _write(vault / "b.md", f"# b\n\n{body}")
    _write(vault / "c.md", "# c\n\nTema totalmente distinto: recetas de cocina.\n")
    index_vault(vault)
    index_vectors(vault, HashingEmbedder(dim=256))

    data = build_reflection(vault, similarity=0.95, max_notes_for_pairs=2)
    assert data["merges"] == []
    assert data["merges_skipped_reason"] is not None
    assert "3" in data["merges_skipped_reason"]
    text = format_reflection(data)
    assert "scan skipped" in text.lower() or "skipped" in text.lower()

    # Below the cap, no skip — behaves like the existing merge-candidates test.
    data_ok = build_reflection(vault, similarity=0.95, max_notes_for_pairs=10)
    assert data_ok["merges_skipped_reason"] is None


def test_pending_promotions_ignores_fenced_example(tmp_path: Path) -> None:
    # A fenced example documenting the pending-observation format (very plausible
    # to write in PRACTICES/observations.md, since that IS what the file
    # documents) must not be proposed as a real promotion candidate.
    vault = tmp_path / "v"
    _write(
        vault / "PRACTICES" / "observations.md",
        "# observations\n\n"
        "Format:\n\n```\n"
        f"- {_old_date(30)} · file.py:1 · example pattern · status: pending\n"
        "```\n\n"
        f"- {_old_date(30)} · real.py:5 · genuine finding · status: pending\n",
    )
    data = build_reflection(vault, since_days=14)
    lines = [p["line"] for p in data["promotions"]]
    assert len(lines) == 1
    assert "genuine finding" in lines[0]


def test_merge_candidates_respects_explicit_embedder_name(tmp_path: Path) -> None:
    # Threading the identity that actually built the index (as cli.py now does
    # via ensure_fresh(...).embedder_name) must find the real duplicates; the
    # bare env/default fallback silently sees zero rows when the vault's index
    # was built under a non-default identity — exactly the split-brain bug.
    vault = tmp_path / "v"
    body = "Pipeline ETL ingesta transformacion carga incremental.\n"
    _write(vault / "a.md", f"# a\n\n{body}")
    _write(vault / "b.md", f"# b\n\n{body}")
    index_vault(vault)
    custom = HashingEmbedder(dim=64)  # non-default dim -> non-default identity
    index_vectors(vault, custom)

    with_identity = build_reflection(vault, similarity=0.95, embedder_name=custom.name)
    assert {(m["a"], m["b"]) for m in with_identity["merges"]} == {("a.md", "b.md")}

    without_identity = build_reflection(vault, similarity=0.95)
    assert without_identity["merges"] == []


def test_recent_activity_digest_counts_tags_and_links(tmp_path: Path) -> None:
    vault = tmp_path / "v"
    _write(
        vault / "SESSION_LOG.md",
        "# log\n\n"
        "## 2026-07-01\n\nTrabajo en [[PROJECTS/kit]] #retrieval\n\n"
        "## 2026-07-02\n\nMás [[PROJECTS/kit]] y #retrieval #bench\n",
    )
    data = build_reflection(vault)
    ra = data["recent_activity"]
    assert ra["sections"] == 2
    tags = {t["tag"]: t["count"] for t in ra["top_tags"]}
    assert tags["retrieval"] == 2
    links = {t["target"]: t["count"] for t in ra["top_links"]}
    assert links["projects/kit"] == 2


def test_recent_activity_ignores_fenced_code_examples(tmp_path: Path) -> None:
    # A fenced example demonstrating the #tag/[[wikilink]] syntax itself must
    # not pollute the real usage counts — same fence-awareness gap already
    # closed in audit.py/graphlink.py/knowledge_graph.py/chunking.py/complete.py.
    vault = tmp_path / "v"
    _write(
        vault / "SESSION_LOG.md",
        "# log\n\n"
        "## 2026-07-01\n\nSyntax example: `` `#example-tag` `` and\n\n```\n"
        "- uses [[some/fake-target]] #fake-tag\n"
        "```\n\nReal work on [[PROJECTS/kit]] #retrieval\n",
    )
    data = build_reflection(vault)
    ra = data["recent_activity"]
    tags = {t["tag"] for t in ra["top_tags"]}
    links = {t["target"] for t in ra["top_links"]}
    assert "fake-tag" not in tags
    assert "some/fake-target" not in links
    assert "retrieval" in tags
    assert "projects/kit" in links


def test_write_note_is_idempotent_per_day(tmp_path: Path) -> None:
    vault = tmp_path / "v"
    vault.mkdir()
    data = build_reflection(vault)
    p1 = write_reflection_note(vault, data, day="2026-07-06")
    first = p1.read_text(encoding="utf-8")
    p2 = write_reflection_note(vault, data, day="2026-07-06")
    assert p1 == p2
    assert p2.read_text(encoding="utf-8") == first
    assert p1.name == "reflection-2026-07-06.md"
    assert "Proposals only" in first


def test_format_reflection_empty_vault_says_good_shape(tmp_path: Path) -> None:
    vault = tmp_path / "v"
    vault.mkdir()
    text = format_reflection(build_reflection(vault))
    assert "good shape" in text

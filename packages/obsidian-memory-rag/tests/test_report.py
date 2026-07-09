from __future__ import annotations

from pathlib import Path

from obsidian_memory_rag import (
    HashingEmbedder,
    build_report,
    index_vault,
    index_vectors,
)


def _vault(tmp_path: Path) -> Path:
    vault = tmp_path / "vault"
    (vault / "docs").mkdir(parents=True)
    (vault / "STACKS").mkdir(parents=True)
    (vault / "docs" / "adr-0023.md").write_text(
        "# ADR-0023\n\n"
        "- implements [[adr-0014]]\n"
        "- relates_to [[STACKS/python]]\n\n"
        "- [decision] typed KG layer #graph\n"
        "- [gotcha] dense RRF scores #graph #rrf\n",
        encoding="utf-8",
    )
    (vault / "docs" / "adr-0014.md").write_text(
        "# ADR-0014\n\nHybrid retrieval. See [[adr-0023]].\n",
        encoding="utf-8",
    )
    (vault / "STACKS" / "python.md").write_text(
        "# python\n\n- [fact] stdlib-only RAG engine #stack\n",
        encoding="utf-8",
    )
    # An orphan note: no [[wikilinks]] in or out.
    (vault / "loose.md").write_text("# Loose\n\nNothing links here or out.\n", encoding="utf-8")
    return vault


def test_report_totals_and_indices(tmp_path: Path) -> None:
    vault = _vault(tmp_path)
    index_vault(vault)
    rep = build_report(vault)
    assert rep["totals"]["notes"] == 4
    assert rep["totals"]["relations"] >= 3
    assert rep["totals"]["observations"] == 3
    cats = {c["category"]: c["count"] for c in rep["indices"]["observations_by_category"]}
    assert cats["decision"] == 1 and cats["gotcha"] == 1 and cats["fact"] == 1
    tags = {t["tag"]: t["count"] for t in rep["indices"]["top_tags"]}
    assert tags["graph"] == 2


def test_report_hub_and_orphan(tmp_path: Path) -> None:
    vault = _vault(tmp_path)
    index_vault(vault)
    rep = build_report(vault)
    hub_paths = [h["path"] for h in rep["indices"]["hub_notes"]]
    # adr-0023 links out twice and is linked back from adr-0014 -> highest degree.
    assert hub_paths[0] == "docs/adr-0023.md"
    assert "loose.md" in rep["hygiene"]["orphan_notes"]


def test_report_suggestions_and_notice(tmp_path: Path) -> None:
    vault = _vault(tmp_path)
    index_vault(vault)
    rep = build_report(vault)
    assert isinstance(rep["suggested_actions"], list) and rep["suggested_actions"]
    assert "Read-only" in rep["notice"]
    # The orphan note should drive an action item.
    assert any("orphan" in s for s in rep["suggested_actions"])


def test_report_duplicates_opt_in(tmp_path: Path) -> None:
    vault = tmp_path / "dup"
    vault.mkdir()
    body = "# {t}\n\nProduction deployment with zero downtime and rolling restarts.\n"
    (vault / "a.md").write_text(body.format(t="Deploy A"), encoding="utf-8")
    (vault / "b.md").write_text(body.format(t="Deploy B"), encoding="utf-8")
    (vault / "c.md").write_text("# Cooking\n\nPancakes and bananas for breakfast.\n", encoding="utf-8")
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    # Without the flag, no duplicate scan runs.
    assert build_report(vault)["review_candidates"]["near_duplicate_notes"] == []
    # With it, the two near-identical deploy notes pair up; cooking does not.
    dupes = build_report(vault, duplicates=True, similarity=0.9)["review_candidates"][
        "near_duplicate_notes"
    ]
    paired = {tuple(sorted((d["a"], d["b"]))) for d in dupes}
    assert ("a.md", "b.md") in paired
    assert all("c.md" not in pair for pair in paired)


def test_report_duplicates_truncated_signals_skip_not_silent_empty(tmp_path: Path) -> None:
    """Above ``max_notes_for_pairs`` the O(n^2) scan is skipped — the report must
    say so explicitly, not return a bare [] indistinguishable from "no dupes"."""
    vault = tmp_path / "dup"
    vault.mkdir()
    body = "# {t}\n\nProduction deployment with zero downtime and rolling restarts.\n"
    (vault / "a.md").write_text(body.format(t="Deploy A"), encoding="utf-8")
    (vault / "b.md").write_text(body.format(t="Deploy B"), encoding="utf-8")
    (vault / "c.md").write_text("# Cooking\n\nPancakes and bananas for breakfast.\n", encoding="utf-8")
    index_vault(vault)
    index_vectors(vault, HashingEmbedder(dim=256))

    # Lower the cap (via the existing override) below the 3 indexed notes instead
    # of constructing 1500 real notes.
    rep = build_report(vault, duplicates=True, similarity=0.9, max_notes_for_pairs=2)
    rc = rep["review_candidates"]
    assert rc["near_duplicate_notes"] == []
    assert "near_duplicate_notes_skipped_reason" in rc
    assert "3" in rc["near_duplicate_notes_skipped_reason"]  # note count surfaced
    assert any("skip" in s.lower() for s in rep["suggested_actions"])

    # Below the cap, no skip signal at all — absence, not a false/empty flag.
    rep_ok = build_report(vault, duplicates=True, similarity=0.9, max_notes_for_pairs=10)
    assert "near_duplicate_notes_skipped_reason" not in rep_ok["review_candidates"]

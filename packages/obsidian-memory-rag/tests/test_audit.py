from __future__ import annotations

import json
from pathlib import Path

from obsidian_memory_rag import audit_vault


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_oversized_flagged_above_budget(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    # ~4 bytes/token: 4000 bytes ~= 1000 tokens. Use a tiny budget so it trips.
    _write(vault / "big.md", "# Big\n\n" + ("x" * 4000))
    _write(vault / "small.md", "# Small\n\ntiny note\n")

    report = audit_vault(vault, budget_tokens=100)
    paths = [o["path"] for o in report["oversized"]]
    assert "big.md" in paths
    assert "small.md" not in paths
    # tokens estimate is ceil(bytes/4) and is reported per oversized note.
    big = next(o for o in report["oversized"] if o["path"] == "big.md")
    assert big["tokens"] > 100
    assert report["totals"]["notes"] == 2


def test_oversized_sorted_desc(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "a.md", "x" * 1000)
    _write(vault / "b.md", "x" * 5000)
    _write(vault / "c.md", "x" * 3000)
    report = audit_vault(vault, budget_tokens=100)
    tokens = [o["tokens"] for o in report["oversized"]]
    assert tokens == sorted(tokens, reverse=True)
    assert [o["path"] for o in report["oversized"]] == ["b.md", "c.md", "a.md"]


def test_broken_link_detected_valid_link_not_flagged(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "existing.md", "# Existing\n\nI am here.\n")
    _write(
        vault / "source.md",
        "# Source\n\nGood: [[Existing]]. Bad: [[Missing]].\n",
    )
    report = audit_vault(vault)
    broken = [(b["source"], b["target"]) for b in report["broken_links"]]
    assert ("source.md", "Missing") in broken
    assert all(b[1] != "Existing" for b in broken)


def test_broken_link_ignores_fenced_and_inline_code_examples(tmp_path: Path) -> None:
    # A note documenting the [[wikilink]] syntax with an example target that was
    # never meant to exist must not be flagged as a broken link.
    vault = tmp_path / "vault"
    _write(
        vault / "docs.md",
        "Use `[[target]]` to link a note.\n\n"
        "```\n"
        "- implements [[adr-0014]]\n"
        "```\n\n"
        "Real broken link: [[Missing]].\n",
    )
    report = audit_vault(vault)
    targets = [b["target"] for b in report["broken_links"]]
    assert targets == ["Missing"]


def test_oversized_and_broken_links_capped_with_total(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    for i in range(5):
        _write(vault / f"n{i}.md", f"# N{i}\n\n[[missing-{i}]]\n" + "x" * 1000)
    report = audit_vault(vault, budget_tokens=10, limit=2)
    assert len(report["oversized"]) == 2
    assert report["oversized_total"] == 5
    assert len(report["broken_links"]) == 2
    assert report["broken_links_total"] == 5


def test_wikilink_alias_and_section_are_stripped(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "target.md", "# Target\n")
    _write(
        vault / "ref.md",
        "[[Target#Heading|Nice Alias]] and [[Ghost#Sec|Label]]\n",
    )
    report = audit_vault(vault)
    targets = [b["target"] for b in report["broken_links"]]
    # Alias + section are stripped: Target resolves (not broken), Ghost is broken.
    assert "Target" not in targets
    assert "Ghost" in targets


def test_broken_link_case_insensitive(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "MyNote.md", "# MyNote\n")
    _write(vault / "ref.md", "[[mynote]] [[MYNOTE]]\n")
    report = audit_vault(vault)
    assert report["broken_links"] == []  # case-insensitive basename match


def test_path_qualified_links_resolve(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "PROJECTS" / "foo.md", "# Foo\n")
    _write(vault / "STACKS" / "bar.md", "# Bar\n")
    _write(
        vault / "ref.md",
        "[[PROJECTS/foo]] [[STACKS/bar]] [[PROJECTS/foo.md]] [[PROJECTS/missing]]\n",
    )
    report = audit_vault(vault)
    targets = [b["target"] for b in report["broken_links"]]
    # Folder-qualified links to existing notes resolve (by full path); the
    # explicit-.md form resolves too; only the truly-missing one is broken.
    assert "PROJECTS/foo" not in targets
    assert "STACKS/bar" not in targets
    assert "PROJECTS/missing" in targets


def test_session_log_token_count_and_over_threshold(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    # 8000 bytes ~= 2000 tokens; threshold 1000 -> over.
    _write(vault / "SESSION_LOG.md", "x" * 8000)
    report = audit_vault(vault, session_log_budget=1000)
    sl = report["session_log"]
    assert sl is not None
    assert sl["path"] == "SESSION_LOG.md"
    assert sl["tokens"] == 2000
    assert sl["over_threshold"] is True


def test_session_log_under_threshold(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "SESSION_LOG.md", "## 2026-06-14\n\nshort entry\n")
    report = audit_vault(vault, session_log_budget=6000)
    assert report["session_log"]["over_threshold"] is False


def test_session_log_absent_is_null(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "note.md", "# Note\n")
    report = audit_vault(vault)
    assert report["session_log"] is None


def test_excludes_tooling_dirs(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "real.md", "# Real\n")
    _write(vault / ".git" / "config.md", "x" * 9000)
    _write(vault / ".obsidian" / "plugin.md", "x" * 9000)
    _write(vault / ".obsidian-memory-rag" / "junk.md", "x" * 9000)
    report = audit_vault(vault, budget_tokens=10)
    assert report["totals"]["notes"] == 1
    assert all(o["path"] == "real.md" for o in report["oversized"])


def test_report_is_json_serializable_with_exact_shape(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "a.md", "[[Missing]]\n" + "x" * 5000)
    _write(vault / "SESSION_LOG.md", "## entry\n")
    report = audit_vault(vault, budget_tokens=100)
    # Round-trips through json with non-ASCII safety, and keeps the documented keys.
    dumped = json.dumps(report, ensure_ascii=False)
    again = json.loads(dumped)
    assert set(again) == {
        "budget_tokens",
        "totals",
        "oversized",
        "oversized_total",
        "broken_links",
        "broken_links_total",
        "session_log",
        "sync_conflicts",
        "sync_conflicts_total",
        "conflict_markers",
        "conflict_markers_total",
        "stale_tmp",
        "stale_tmp_total",
        "git_state",
        "schema_violations",
        "schema_violations_total",
        "stale_hypotheses",
        "stale_hypotheses_total",
        "unverified",
        "unverified_total",
    }
    assert set(again["totals"]) == {"notes", "tokens"}
    assert again["budget_tokens"] == 100


def test_sync_conflict_files_reported_any_extension(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "clean.md", "# ok\n")
    _write(vault / "MEMORY.sync-conflict-20260706-101010-ABC.md", "theirs\n")
    _write(vault / "img.sync-conflict-20260706-101010-ABC.png", "binaryish")
    _write(vault / ".obsidian-memory-rag" / "x.sync-conflict-1.md", "excluded dir")
    report = audit_vault(vault)
    paths = [c["path"] for c in report["sync_conflicts"]]
    assert "MEMORY.sync-conflict-20260706-101010-ABC.md" in paths
    assert "img.sync-conflict-20260706-101010-ABC.png" in paths
    assert report["sync_conflicts_total"] == 2


def test_conflict_markers_flagged_outside_code_only(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(
        vault / "corrupt.md",
        "# note\n\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> other\n",
    )
    _write(
        vault / "docs.md",
        "How markers look:\n\n```\n<<<<<<< HEAD\n```\n",
    )
    report = audit_vault(vault)
    flagged = {m["path"]: m["line"] for m in report["conflict_markers"]}
    assert flagged == {"corrupt.md": 3}
    assert report["conflict_markers_total"] == 1


def test_stale_tmp_files_reported_only_when_old(tmp_path: Path) -> None:
    import os
    import time as _time

    vault = tmp_path / "vault"
    _write(vault / "note.md", "# ok\n")
    old = vault / "note.md.tmp-1234-1700000000000"
    _write(old, "half-written")
    two_hours_ago = _time.time() - 7200
    os.utime(old, (two_hours_ago, two_hours_ago))
    fresh = vault / "other.md.tmp-999-1700000000001"
    _write(fresh, "in-flight write")  # mtime = now → not stale
    report = audit_vault(vault)
    paths = [t["path"] for t in report["stale_tmp"]]
    assert paths == ["note.md.tmp-1234-1700000000000"]
    assert report["stale_tmp"][0]["age_hours"] >= 1.9
    assert report["stale_tmp_total"] == 1


def test_schema_violations_none_without_config(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "PROJECTS" / "x.md", "no frontmatter\n")
    report = audit_vault(vault)
    assert report["schema_violations"] is None
    assert report["schema_violations_total"] is None


def test_schema_violations_folder_rule_and_wildcard(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(
        vault / "memory-schema.json",
        json.dumps(
            {
                "folders": {
                    "PROJECTS": {"required": ["title", "type"]},
                    "*": {"required": ["title"]},
                }
            }
        ),
    )
    _write(vault / "PROJECTS" / "bad.md", "---\ntitle: x\n---\nbody\n")
    _write(vault / "PROJECTS" / "good.md", "---\ntitle: x\ntype: t\n---\nbody\n")
    _write(vault / "root-bad.md", "just prose\n")
    _write(vault / "root-good.md", "---\ntitle: y\n---\n")
    report = audit_vault(vault)
    violations = {v["path"]: v["missing"] for v in report["schema_violations"]}
    assert violations == {"PROJECTS/bad.md": ["type"], "root-bad.md": ["title"]}
    assert report["schema_violations_total"] == 2


def test_schema_violations_explicit_empty_folder_rule_overrides_wildcard(tmp_path: Path) -> None:
    # {} for a folder ("no required frontmatter here") is a legitimate override
    # of "*" — a truthiness check on the rule wrongly fell through past an empty
    # dict (falsy) to the wildcard instead of treating it as "no requirement".
    vault = tmp_path / "vault"
    _write(
        vault / "memory-schema.json",
        json.dumps({"folders": {"NOTES": {}, "*": {"required": ["date"]}}}),
    )
    _write(vault / "NOTES" / "a.md", "no frontmatter, no date\n")
    report = audit_vault(vault)
    assert report["schema_violations"] == []
    assert report["schema_violations_total"] == 0


def test_schema_violations_malformed_config_ignored(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "memory-schema.json", "not json {{")
    _write(vault / "a.md", "x\n")
    report = audit_vault(vault)
    assert report["schema_violations"] is None


def test_stale_hypotheses_and_unverified_from_frontmatter(tmp_path: Path) -> None:
    import time as _time

    vault = tmp_path / "vault"
    old_day = _time.strftime("%Y-%m-%d", _time.localtime(_time.time() - 120 * 86_400))
    ancient_day = _time.strftime("%Y-%m-%d", _time.localtime(_time.time() - 400 * 86_400))
    today = _time.strftime("%Y-%m-%d")
    _write(
        vault / "old-hypo.md",
        f"---\nstatus: hypothesis\nlast_verified: {old_day}\n---\nQuizá X.\n",
    )
    _write(
        vault / "fresh-hypo.md",
        f"---\nstatus: hypothesis\nlast_verified: {today}\n---\nQuizá Y.\n",
    )
    _write(
        vault / "ancient-fact.md",
        f"---\nstatus: confirmed\nlast_verified: {ancient_day}\n---\nHecho.\n",
    )
    _write(vault / "plain.md", "Sin frontmatter.\n")
    report = audit_vault(vault)
    assert [h["path"] for h in report["stale_hypotheses"]] == ["old-hypo.md"]
    assert report["stale_hypotheses"][0]["age_days"] >= 119
    assert [u["path"] for u in report["unverified"]] == ["ancient-fact.md"]
    assert report["stale_hypotheses_total"] == 1
    assert report["unverified_total"] == 1


def test_confidence_falls_back_to_mtime_without_last_verified(tmp_path: Path) -> None:
    import os
    import time as _time

    vault = tmp_path / "vault"
    fp = vault / "hypo.md"
    _write(fp, "---\nstatus: hypothesis\n---\nQuizá Z.\n")
    old = _time.time() - 200 * 86_400
    os.utime(fp, (old, old))
    report = audit_vault(vault)
    assert [h["path"] for h in report["stale_hypotheses"]] == ["hypo.md"]


def test_git_state_none_without_repo_and_flags_rebase(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    _write(vault / "a.md", "# ok\n")
    assert audit_vault(vault)["git_state"] is None

    (vault / ".git").mkdir()
    report = audit_vault(vault)
    assert report["git_state"] == {"rebase_in_progress": False, "merge_in_progress": False}

    (vault / ".git" / "rebase-merge").mkdir()
    (vault / ".git" / "MERGE_HEAD").write_text("abc\n", encoding="utf-8")
    report = audit_vault(vault)
    assert report["git_state"] == {"rebase_in_progress": True, "merge_in_progress": True}


def test_template_placeholder_links_are_not_broken(tmp_path):
    """[[X/<placeholder>]] is deliberate scaffolding (RULES/TEMPLATE), not a broken link."""
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "TEMPLATE.md").write_text(
        "Reglas de [[PROJECTS/<proyecto>]] y un roto real [[ghost-note]].\n",
        encoding="utf-8",
    )
    report = audit_vault(vault)
    targets = [b["target"] for b in report["broken_links"]]
    assert "PROJECTS/<proyecto>" not in targets
    assert "ghost-note" in targets

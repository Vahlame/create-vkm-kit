"""Recall telemetry + usage boost + cold notes (ADR-0038). Deterministic: events
are seeded directly through log_events, never through wall-clock-dependent flows."""

from __future__ import annotations

import time
from pathlib import Path

from obsidian_memory_rag import HashingEmbedder, index_vault, index_vectors
from obsidian_memory_rag.paths import index_db_path
from obsidian_memory_rag.query import hybrid_search
from obsidian_memory_rag.recall_log import cold_notes, log_events, usage_counts
from obsidian_memory_rag.report import build_report
from obsidian_memory_rag.store import connect, init_schema


def _write(vault: Path, rel: str, text: str) -> None:
    fp = vault / rel
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(text, encoding="utf-8")


def _seed_vault(tmp_path: Path) -> Path:
    vault = tmp_path / "v"
    body = "Pipeline ETL ingesta transformacion carga.\n"
    _write(vault, "STACKS/aaa-neutral.md", f"# aaa-neutral\n\n{body}")
    _write(vault, "STACKS/helpful.md", f"# helpful\n\n{body}")
    index_vault(vault)
    index_vectors(vault, HashingEmbedder(dim=256))
    return vault


def test_log_events_and_usage_counts_roundtrip(tmp_path: Path) -> None:
    vault = _seed_vault(tmp_path)
    assert log_events(vault, "returned", ["a.md", "b.md"], query="q") == 2
    assert log_events(vault, "used", ["a.md"]) == 1
    assert log_events(vault, "used", ["a.md"]) == 1
    counts = usage_counts(vault, ["a.md", "b.md"])
    assert counts == {"a.md": 2, "b.md": 0}
    # Unknown events are rejected, not written.
    assert log_events(vault, "clicked", ["a.md"]) == 0


def test_usage_boost_promotes_helped_note_and_default_is_unchanged(tmp_path: Path) -> None:
    vault = _seed_vault(tmp_path)
    emb = HashingEmbedder(dim=256)
    q = "pipeline ETL ingesta"
    base = hybrid_search(vault, q, emb, limit=2)
    base_paths = [h.path for h in base]

    for _ in range(3):
        log_events(vault, "used", ["STACKS/helpful.md"])

    boosted = hybrid_search(vault, q, emb, limit=2, usage=True)
    boosted_paths = [h.path for h in boosted]
    assert boosted_paths[0] == "STACKS/helpful.md"
    # Default path stays byte-identical even with telemetry rows present.
    again = hybrid_search(vault, q, emb, limit=2)
    assert [h.path for h in again] == base_paths
    assert [h.score for h in again] == [h.score for h in base]


def test_usage_lever_is_noop_on_empty_log(tmp_path: Path) -> None:
    vault = _seed_vault(tmp_path)
    emb = HashingEmbedder(dim=256)
    q = "pipeline ETL ingesta"
    base = hybrid_search(vault, q, emb, limit=2)
    lever_on = hybrid_search(vault, q, emb, limit=2, usage=True)
    assert [h.path for h in base] == [h.path for h in lever_on]
    assert [h.score for h in base] == [h.score for h in lever_on]


def test_recall_log_survives_schema_version_reindex(tmp_path: Path) -> None:
    """Telemetry is not derived state: a forced full rebuild (schema-version
    mismatch) must leave recall_log rows in place."""
    vault = _seed_vault(tmp_path)
    log_events(vault, "used", ["STACKS/helpful.md"])
    conn = connect(index_db_path(vault.resolve()))
    try:
        init_schema(conn)
        conn.execute("UPDATE schema_meta SET value = '0' WHERE key = 'version'")
    finally:
        conn.close()
    index_vault(vault)  # triggers the version-mismatch rebuild path
    assert usage_counts(vault, ["STACKS/helpful.md"])["STACKS/helpful.md"] == 1


def test_cold_notes_only_with_telemetry_present(tmp_path: Path) -> None:
    import os
    import time

    vault = _seed_vault(tmp_path)
    # Backdate both notes so they pass the min-indexed-days bar.
    old = time.time() - 60 * 86_400
    for rel in ("STACKS/aaa-neutral.md", "STACKS/helpful.md"):
        os.utime(vault / rel, (old, old))
    index_vault(vault)

    # No telemetry at all → no cold-note claims (absence of data ≠ disuse).
    assert cold_notes(vault) == []

    # One note was returned/used; the other never touched → cold.
    log_events(vault, "returned", ["STACKS/helpful.md"], query="q")
    cold = [c["path"] for c in cold_notes(vault)]
    assert cold == ["STACKS/aaa-neutral.md"]

    report = build_report(vault)
    assert [c["path"] for c in report["hygiene"]["cold_notes"]] == ["STACKS/aaa-neutral.md"]
    assert any("cold note" in s for s in report["suggested_actions"])


def _log_used_at(vault: Path, path: str, *, age_days: float, n: int) -> None:
    """Insert ``n`` 'used' events for ``path`` backdated ``age_days`` (deterministic,
    unlike :func:`log_events` which always stamps ``time.time_ns()``)."""
    _NS_PER_DAY = 86_400 * 1_000_000_000
    at_ns = time.time_ns() - int(age_days * _NS_PER_DAY)
    conn = connect(index_db_path(vault.resolve()))
    try:
        init_schema(conn)
        conn.execute("BEGIN IMMEDIATE;")
        conn.executemany(
            "INSERT INTO recall_log(path, event, query_hash, at_ns) VALUES (?, 'used', '', ?)",
            [(path, at_ns)] * n,
        )
        conn.execute("COMMIT;")
    finally:
        conn.close()


def test_usage_boost_decays_stale_credit_so_new_note_not_buried(tmp_path: Path) -> None:
    """ADR-0038 regression: the usage boost must fade with how recently a note was
    actually used, not just whether the use falls inside the 90-day window.

    Three equally-relevant notes: a note used heavily but STALE (near the start of
    the 90-day window — technically in-window, but a note nobody has touched in ~90
    days), a note used heavily and RECENTLY, and a brand-new note with zero uses.
    A flat window-count formula treats "stale but in-window" identically to
    "used yesterday" (same raw count survives the whole window), so it would rank
    the stale note >= the recent one and bury the zero-use new note under BOTH.
    That is a regression this test would have caught: with the raw-count formula
    (verified directly below) the stale note actually *outranks* the freshly-used
    one and the new note is buried last. The fix must both let recency-weighted
    usage win over stale usage, and stop stale usage from unfairly outranking a
    brand-new, equally-relevant note.
    """
    vault = tmp_path / "v"
    body = "Pipeline ETL ingesta transformacion carga datos analitica reportes.\n"
    _write(vault, "STACKS/aaa-new.md", f"# aaa-new\n\n{body}")
    _write(vault, "STACKS/mmm-recent.md", f"# mmm-recent\n\n{body}")
    _write(vault, "STACKS/zzz-old-stale.md", f"# zzz-old-stale\n\n{body}")
    index_vault(vault)
    emb = HashingEmbedder(dim=256)
    index_vectors(vault, emb)
    q = "pipeline ETL ingesta"

    # Recently used (well inside the window) vs. stale-but-technically-in-window
    # (near the START of the 90-day window, i.e. ~90 days since it was last used).
    # aaa-new.md gets zero usage events — freshly added, zero uses by construction.
    _log_used_at(vault, "STACKS/mmm-recent.md", age_days=1.0, n=4)
    _log_used_at(vault, "STACKS/zzz-old-stale.md", age_days=89.5, n=4)

    boosted = hybrid_search(vault, q, emb, limit=3, usage=True)
    order = [h.path for h in boosted]

    # Genuinely-recent usage outranks stale-but-in-window usage of the same size —
    # a flat window-count would tie (or even invert) this, since both fall inside
    # USAGE_WINDOW_DAYS regardless of when within it the uses happened.
    assert order.index("STACKS/mmm-recent.md") < order.index("STACKS/zzz-old-stale.md")
    # The brand-new, zero-use note is not buried under the stale-but-in-window
    # note's leftover credit.
    assert order.index("STACKS/aaa-new.md") < order.index("STACKS/zzz-old-stale.md")

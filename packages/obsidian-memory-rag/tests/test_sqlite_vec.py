"""sqlite-vec acceleration parity (ADR-0025).

These only run where the optional `sqlite-vec` extension is installed and loadable
(it is absent in the dependency-free CI matrix, so they skip there). The contract
under test: the accelerated path returns the *same ranking* as the pure-Python
brute force — it is an acceleration, never an approximation.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from obsidian_memory_rag import HashingEmbedder, index_vault, index_vectors
from obsidian_memory_rag.paths import index_db_path
from obsidian_memory_rag.store import connect
from obsidian_memory_rag.vector_store import _load_sqlite_vec, search_chunks


def _sqlite_vec_loadable() -> bool:
    conn = sqlite3.connect(":memory:")
    try:
        return _load_sqlite_vec(conn)
    finally:
        conn.close()


pytestmark = pytest.mark.skipif(
    not _sqlite_vec_loadable(), reason="sqlite-vec extension not installed/loadable"
)


def _corpus(tmp_path: Path) -> Path:
    vault = tmp_path / "vault"
    vault.mkdir()
    notes = {
        "deploy": "Production deployment with zero downtime and rolling restarts.",
        "rollback": "How to roll back a bad release and restore the previous version.",
        "backup": "Database backup schedule, WAL checkpoints and the online backup API.",
        "food": "Bananas, pancakes and coffee for a slow weekend breakfast.",
        "travel": "Packing list for a long trip: passport, chargers, a good book.",
        "incident": "Incident response runbook: page on-call, triage, mitigate, write postmortem.",
    }
    for name, body in notes.items():
        (vault / f"{name}.md").write_text(f"# {name}\n\n{body}\n", encoding="utf-8")
    return vault


def test_sqlite_vec_ranking_matches_bruteforce(tmp_path: Path, monkeypatch) -> None:
    vault = _corpus(tmp_path)
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    q = emb.embed(["production deployment rollout downtime"])[0]
    db = index_db_path(vault.resolve())

    monkeypatch.delenv("OBSIDIAN_MEMORY_SQLITE_VEC", raising=False)
    conn = connect(db)
    try:
        brute = search_chunks(conn, q, emb.name, 5)
    finally:
        conn.close()

    monkeypatch.setenv("OBSIDIAN_MEMORY_SQLITE_VEC", "1")
    conn = connect(db)
    try:
        accel = search_chunks(conn, q, emb.name, 5)
    finally:
        conn.close()

    assert [h.path for h in accel] == [h.path for h in brute], "ranking must be identical"
    for a, b in zip(accel, brute):
        assert abs(a.score - b.score) < 1e-4, "cosine score must match within float tolerance"


def test_disabled_by_default(tmp_path: Path, monkeypatch) -> None:
    # With the flag unset, search must use the brute-force path even when the
    # extension is available — the default stays deterministic + dependency-free.
    vault = _corpus(tmp_path)
    emb = HashingEmbedder(dim=256)
    index_vault(vault)
    index_vectors(vault, emb)
    monkeypatch.delenv("OBSIDIAN_MEMORY_SQLITE_VEC", raising=False)
    q = emb.embed(["incident postmortem on-call"])[0]
    conn = connect(index_db_path(vault.resolve()))
    try:
        hits = search_chunks(conn, q, emb.name, 3)
    finally:
        conn.close()
    assert hits and hits[0].path == "incident.md"

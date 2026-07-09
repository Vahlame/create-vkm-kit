from __future__ import annotations

from pathlib import Path

from obsidian_memory_rag import (
    HashingEmbedder,
    ensure_fresh,
    index_vault,
    index_vectors,
    search_vault,
)
from obsidian_memory_rag.paths import index_db_path
from obsidian_memory_rag.store import connect
from obsidian_memory_rag.vector_store import has_any_chunks


def test_ensure_fresh_indexes_new_note_without_manual_index(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "fresh.md").write_text(
        "# Fresh note\n\nsupercalifragilistic content here.\n",
        encoding="utf-8",
    )
    # No manual index_vault() call — ensure_fresh must do it.
    res = ensure_fresh(vault)
    assert res.fts.inserted == 1
    hits = search_vault(vault, "supercalifragilistic", limit=5)
    assert len(hits) == 1
    assert hits[0].path == "fresh.md"


def test_ensure_fresh_picks_up_edits(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    p = vault / "doc.md"
    p.write_text("# Doc\n\noldphrase\n", encoding="utf-8")
    ensure_fresh(vault)
    assert search_vault(vault, "oldphrase")

    p.write_text("# Doc\n\nnewphrase\n", encoding="utf-8")
    ensure_fresh(vault)  # incremental refresh sees the edit
    assert not search_vault(vault, "oldphrase")
    assert search_vault(vault, "newphrase")


def test_ensure_fresh_does_not_build_vectors_by_default(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "note.md").write_text("# Note\n\nplain content\n", encoding="utf-8")
    res = ensure_fresh(vault)  # semantic not requested, no prior vectors
    assert res.vectors is None

    conn = connect(index_db_path(vault.resolve()))
    try:
        assert has_any_chunks(conn) is False  # zero-dependency default preserved
    finally:
        conn.close()


def test_ensure_fresh_builds_vectors_when_semantic_requested(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "note.md").write_text(
        "# Note\n\nshipping to production with zero downtime\n",
        encoding="utf-8",
    )
    res = ensure_fresh(vault, semantic=True, embedder=HashingEmbedder(dim=64))
    assert res.vectors is not None
    assert res.vectors.embedded == 1

    conn = connect(index_db_path(vault.resolve()))
    try:
        assert has_any_chunks(conn) is True
    finally:
        conn.close()


def test_ensure_fresh_refreshes_existing_vectors(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    p = vault / "note.md"
    p.write_text("# Note\n\nfirst body\n", encoding="utf-8")
    emb = HashingEmbedder(dim=64)
    # Opt in once the "old" way.
    index_vault(vault)
    index_vectors(vault, emb)

    # A later edit + plain ensure_fresh (no semantic flag) must still refresh
    # vectors, because this vault already opted in (note_chunks non-empty).
    p.write_text("# Note\n\nsecond body changed\n", encoding="utf-8")
    res = ensure_fresh(vault, embedder=emb)
    assert res.vectors is not None
    assert res.vectors.embedded == 1  # the edited note was re-embedded


def test_ensure_fresh_reuses_existing_embedder_identity_on_bare_call(
    tmp_path: Path, monkeypatch
) -> None:
    """A bare ``ensure_fresh(vault)`` call (no explicit ``embedder=``, no env
    override) — what every non-hybrid-search CLI subcommand does — must keep
    refreshing whatever embedder identity already built the on-disk vector index,
    not silently fall back to the env/default resolution and start a second,
    redundant vector index beside it (embedder-identity drift)."""
    monkeypatch.delenv("OBSIDIAN_MEMORY_EMBEDDER", raising=False)
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "note.md").write_text("# Note\n\nfirst body\n", encoding="utf-8")

    # Opt in once with a NON-default identity (hashing-64) — a bare call would
    # otherwise resolve to the hashing-256 default via get_embedder(None).
    index_vault(vault)
    index_vectors(vault, HashingEmbedder(dim=64))

    # A later edit, then the bare call under test.
    (vault / "note.md").write_text("# Note\n\nsecond body changed\n", encoding="utf-8")
    res = ensure_fresh(vault)
    assert res.vectors is not None
    assert res.vectors.embedded == 1  # the edited note was re-embedded under hashing-64

    conn = connect(index_db_path(vault.resolve()))
    try:
        names = {
            str(r["embedder"])
            for r in conn.execute("SELECT DISTINCT embedder FROM note_chunks").fetchall()
        }
    finally:
        conn.close()
    # Only the original identity is present — no second "hashing-256" index was
    # silently created alongside it.
    assert names == {"hashing-64"}

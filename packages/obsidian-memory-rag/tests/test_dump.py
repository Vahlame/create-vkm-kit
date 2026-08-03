"""The json-dump-index / json-embed-query wire (dump.py), field by field.

The payload shapes are a frozen cross-agent contract: the Node pg-service parses
them verbatim to project the sidecar index into Postgres. These tests pin the
parts the smoke test cannot see — the always-complete manifest on an incremental
dump, the changed-set semantics (``mtime_ns >= since`` unioned with the explicit
``paths`` selector), per-chunk ``mtime_ns`` freshness, base64 float32 vector
round-trips, and the error objects (no vectors / empty query embedding).
"""

from __future__ import annotations

import base64
import json
import math
import os
from array import array
from pathlib import Path

import pytest

from obsidian_memory_rag import cli
from obsidian_memory_rag.dump import dump_index, embed_query
from obsidian_memory_rag.embeddings import HashingEmbedder
from obsidian_memory_rag.indexer import index_vault, index_vectors

# Same shape as the smoke fixture: wikilinks, one typed relation, categorized
# observations with #tags, notes at the root, inside a folder and nested two
# levels deep (the depth where folder=first-segment and folder=dirname diverge).
NOTES: dict[str, str] = {
    "MEMORY.md": (
        "# Memory\n\n"
        "Prefers Markdown notes under git over a database. See [[PROJECTS/bike-shop]].\n\n"
        "- [decision] plain Markdown beats a database for portable memory #architecture\n"
    ),
    "PROJECTS/bike-shop.md": (
        "# bike-shop\n\n"
        "Bike workshop app on Tauri 2 with Svelte 5 and Supabase.\n\n"
        "- implements [[STACKS/tauri]]\n"
        "- [decision] Tauri over Electron for the desktop shell #tauri\n"
    ),
    "PROJECTS/sub/deep.md": (
        "# deep\n\nNested note two folder levels down.\n\n"
        "- [fact] nested folders exist #structure\n"
    ),
    "STACKS/tauri.md": (
        "# tauri\n\nRust-backed desktop shell. Verdict: like.\n\n"
        "- [fact] Tauri 2 ships a mobile target #tauri\n"
    ),
}


def _make_vault(root: Path) -> Path:
    for rel, body in NOTES.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body, encoding="utf-8")
    index_vault(root)
    return root


def _set_mtimes(vault: Path, spec: dict[str, int]) -> None:
    """Pin exact per-note mtimes (then reindex so ``indexed_files`` records them).

    Filesystem timestamp granularity can tie every fixture note at the same
    mtime; the incremental-semantics tests need known, distinct values.
    """
    for rel, ns in spec.items():
        os.utime(vault / rel, ns=(ns, ns))
    index_vault(vault)


def _decode_vec(vec_b64: str) -> array:
    out = array("f")
    out.frombytes(base64.b64decode(vec_b64))
    return out


def test_full_dump_shape(tmp_path: Path) -> None:
    vault = _make_vault(tmp_path / "vault")
    d = dump_index(vault)

    assert d["schema"] == 1
    # No vectors were ever built: embedder/dim are null and chunks empty.
    assert d["embedder"] is None
    assert d["dim"] is None
    assert d["chunks"] == []

    assert [path for path, _ in d["manifest"]] == sorted(NOTES)
    assert all(isinstance(m, int) and m > 0 for _, m in d["manifest"])

    assert [n["path"] for n in d["notes"]] == sorted(NOTES)
    by_path = {n["path"]: n for n in d["notes"]}
    memory = by_path["MEMORY.md"]
    assert memory["title"] == "Memory"
    assert memory["folder"] == ""
    assert "portable memory" in memory["body"]
    assert memory["size_b"] == (vault / "MEMORY.md").stat().st_size
    assert memory["mtime_ns"] == (vault / "MEMORY.md").stat().st_mtime_ns
    assert by_path["PROJECTS/bike-shop.md"]["folder"] == "PROJECTS"
    # folder is the FIRST path segment (the consumer's folderOf semantic), not
    # the posix dirname — they only diverge at nesting depth >= 2.
    assert by_path["PROJECTS/sub/deep.md"]["folder"] == "PROJECTS"

    assert {
        "source_path": "PROJECTS/bike-shop.md",
        "relation_type": "implements",
        "target": "stacks/tauri",
        "context": "",
    } in d["relations"]

    obs = {(o["source_path"], o["category"]): o for o in d["observations"]}
    decision = obs[("PROJECTS/bike-shop.md", "decision")]
    assert decision["tags"] == ["tauri"]
    assert decision["ordinal"] == 0
    assert "Electron" in decision["content"]

    assert d["count"] == {
        "notes": len(d["notes"]),
        "chunks": 0,
        "relations": len(d["relations"]),
        "observations": len(d["observations"]),
    }


def test_since_filter_is_inclusive_and_keeps_manifest_complete(tmp_path: Path) -> None:
    """``since`` selects ``mtime_ns >= cursor``: a cursor-tied edit re-sends.

    The re-send is a harmless upsert on the consumer side; the alternative
    (strict ``>``) silently drops any note whose edit does not advance past the
    stored cursor.
    """
    vault = _make_vault(tmp_path / "vault")
    second = 1_000_000_000
    anchor = (vault / "MEMORY.md").stat().st_mtime_ns
    spec = {
        "MEMORY.md": anchor,
        "PROJECTS/bike-shop.md": anchor + second,  # exactly AT the cursor
        "PROJECTS/sub/deep.md": anchor + 2 * second,
        "STACKS/tauri.md": anchor + 3 * second,
    }
    _set_mtimes(vault, spec)

    d = dump_index(vault, since_mtime_ns=spec["PROJECTS/bike-shop.md"])

    # The cursor-tied note is included (>=), the strictly-older one is not...
    assert [n["path"] for n in d["notes"]] == [
        "PROJECTS/bike-shop.md",
        "PROJECTS/sub/deep.md",
        "STACKS/tauri.md",
    ]
    assert d["count"]["notes"] == 3
    # ...relations/observations cover exactly the changed set...
    assert d["relations"] and all(r["source_path"] != "MEMORY.md" for r in d["relations"])
    assert d["observations"] and all(
        o["source_path"] != "MEMORY.md" for o in d["observations"]
    )
    # ...while the manifest still lists EVERY indexed file (deletion diffing).
    assert [path for path, _ in d["manifest"]] == sorted(NOTES)


def test_paths_included_regardless_of_since(tmp_path: Path) -> None:
    """Explicit ``paths`` join the changed set even when the cursor excludes them."""
    vault = _make_vault(tmp_path / "vault")
    beyond = max(mtime for _, mtime in dump_index(vault)["manifest"]) + 1_000_000_000

    d = dump_index(vault, since_mtime_ns=beyond, paths=["PROJECTS/bike-shop.md"])

    assert [n["path"] for n in d["notes"]] == ["PROJECTS/bike-shop.md"]
    assert d["relations"] and all(
        r["source_path"] == "PROJECTS/bike-shop.md" for r in d["relations"]
    )
    assert d["observations"] and all(
        o["source_path"] == "PROJECTS/bike-shop.md" for o in d["observations"]
    )
    assert [path for path, _ in d["manifest"]] == sorted(NOTES)


def test_since_and_paths_are_a_union(tmp_path: Path) -> None:
    vault = _make_vault(tmp_path / "vault")
    second = 1_000_000_000
    anchor = (vault / "MEMORY.md").stat().st_mtime_ns
    spec = {
        "MEMORY.md": anchor,
        "PROJECTS/bike-shop.md": anchor + second,
        "PROJECTS/sub/deep.md": anchor + 2 * second,
        "STACKS/tauri.md": anchor + 3 * second,
    }
    _set_mtimes(vault, spec)

    d = dump_index(vault, since_mtime_ns=spec["STACKS/tauri.md"], paths=["MEMORY.md"])

    assert [n["path"] for n in d["notes"]] == ["MEMORY.md", "STACKS/tauri.md"]


def test_paths_alone_covers_exactly_those_paths(tmp_path: Path) -> None:
    """Without a cursor, ``paths`` restricts the dump to exactly those notes.

    This is what makes the consumer's follow-up ``runDump({paths})`` targeted —
    a full dump only happens when NEITHER selector is passed.
    """
    vault = _make_vault(tmp_path / "vault")

    d = dump_index(vault, paths=["MEMORY.md", "STACKS/tauri.md"])

    assert [n["path"] for n in d["notes"]] == ["MEMORY.md", "STACKS/tauri.md"]
    assert [path for path, _ in d["manifest"]] == sorted(NOTES)


def test_include_vectors_ships_decodable_float32(tmp_path: Path) -> None:
    vault = _make_vault(tmp_path / "vault")
    embedder = HashingEmbedder(dim=16)
    index_vectors(vault, embedder)

    d = dump_index(vault, include_vectors=True)
    assert d["embedder"] == "hashing-16"
    assert d["dim"] == 16
    assert d["chunks"], "vector index built but the dump shipped no chunks"
    manifest_mtimes = {path: mtime for path, mtime in d["manifest"]}
    for chunk in d["chunks"]:
        raw = base64.b64decode(chunk["vec_b64"])
        assert len(raw) == 16 * 4  # dim float32 values, 4 bytes each
        assert len(_decode_vec(chunk["vec_b64"])) == 16
        # Every chunk row carries its own mtime_ns (freshness signal for the
        # consumer's stale-chunk skip); freshly built chunks match the note's
        # indexed mtime exactly.
        assert chunk["mtime_ns"] == manifest_mtimes[chunk["path"]]

    # Without the flag the same rows ship metadata only — no vec_b64 key at all
    # (but mtime_ns still ships: it is metadata, not vector payload).
    lean = dump_index(vault)
    assert lean["chunks"] and all("vec_b64" not in c for c in lean["chunks"])
    assert all(isinstance(c["mtime_ns"], int) for c in lean["chunks"])
    assert lean["count"]["chunks"] == d["count"]["chunks"]


def test_embed_query_matches_index_identity_and_norm(tmp_path: Path) -> None:
    vault = _make_vault(tmp_path / "vault")
    index_vectors(vault, HashingEmbedder(dim=16))

    r = embed_query(vault, "tauri desktop shell")
    assert r["embedder"] == "hashing-16"  # dominant on-disk identity, not the default
    assert r["dim"] == 16
    vec = _decode_vec(r["vec_b64"])
    assert len(vec) == 16
    # Stored chunks are L2-normalized; the query must be too (cosine == dot).
    assert math.isclose(math.fsum(x * x for x in vec), 1.0, abs_tol=1e-5)


def test_embed_query_explicit_embedder_wins(tmp_path: Path) -> None:
    vault = _make_vault(tmp_path / "vault")
    index_vectors(vault, HashingEmbedder(dim=16))

    r = embed_query(vault, "tauri", embedder_name="hashing-32")
    assert r["embedder"] == "hashing-32"
    assert r["dim"] == 32
    assert len(_decode_vec(r["vec_b64"])) == 32


def test_embed_query_without_vectors_is_an_error_object(tmp_path: Path) -> None:
    vault = _make_vault(tmp_path / "vault")  # FTS only, no index_vectors
    assert embed_query(vault, "anything") == {"error": "no vectors indexed"}


def test_embed_query_featureless_query_is_an_error_object(tmp_path: Path) -> None:
    """A query with no word tokens embeds to the zero vector — pgvector cosine
    against it is NaN, so the wire ships the documented error object instead."""
    vault = _make_vault(tmp_path / "vault")
    index_vectors(vault, HashingEmbedder(dim=16))

    assert embed_query(vault, "!!! ??? ...") == {
        "error": "query produced an empty embedding"
    }


def test_cli_wire_roundtrip(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """End-to-end through cli.main: flags parse and stdout is one JSON object."""
    vault = _make_vault(tmp_path / "vault")
    index_vectors(vault, HashingEmbedder(dim=16))

    cli.main(["json-dump-index", "--vault", str(vault), "--include-vectors"])
    payload = json.loads(capsys.readouterr().out)
    assert payload["schema"] == 1
    assert payload["chunks"] and all("vec_b64" in c for c in payload["chunks"])

    cursor = max(mtime for _, mtime in payload["manifest"])
    cli.main(
        [
            "json-dump-index",
            "--vault",
            str(vault),
            "--since-mtime-ns",
            str(cursor),
            "--no-auto-index",
        ]
    )
    incremental = json.loads(capsys.readouterr().out)
    # >= semantics: exactly the cursor-tied notes re-send (harmless upserts).
    assert [n["path"] for n in incremental["notes"]] == sorted(
        path for path, mtime in payload["manifest"] if mtime >= cursor
    )
    assert [path for path, _ in incremental["manifest"]] == sorted(NOTES)

    # --paths: targeted follow-up — included even though the cursor excludes all.
    cli.main(
        [
            "json-dump-index",
            "--vault",
            str(vault),
            "--since-mtime-ns",
            str(cursor + 10_000_000_000),
            "--paths",
            "MEMORY.md,PROJECTS/bike-shop.md",
            "--no-auto-index",
        ]
    )
    targeted = json.loads(capsys.readouterr().out)
    assert [n["path"] for n in targeted["notes"]] == ["MEMORY.md", "PROJECTS/bike-shop.md"]
    assert targeted["chunks"] and all(
        c["path"] in ("MEMORY.md", "PROJECTS/bike-shop.md") for c in targeted["chunks"]
    )
    assert [path for path, _ in targeted["manifest"]] == sorted(NOTES)

    cli.main(["json-embed-query", "--vault", str(vault), "--query", "tauri"])
    embedded = json.loads(capsys.readouterr().out)
    assert embedded["dim"] == 16
    assert len(base64.b64decode(embedded["vec_b64"])) == 16 * 4


def test_cli_dump_refreshes_existing_vectors(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """json-dump-index runs ensure_fresh(semantic=False): a vault that already
    has vectors gets them refreshed pre-dump, so the chunks shipped for an
    edited note match the note body shipped beside them (not one edit behind)."""
    vault = _make_vault(tmp_path / "vault")
    index_vectors(vault, HashingEmbedder(dim=16))

    target = vault / "STACKS" / "tauri.md"
    target.write_text(
        NOTES["STACKS/tauri.md"] + "\nFreshly edited chunk body marker.\n",
        encoding="utf-8",
    )
    bumped = target.stat().st_mtime_ns + 5_000_000_000
    os.utime(target, ns=(bumped, bumped))

    cli.main(["json-dump-index", "--vault", str(vault)])
    payload = json.loads(capsys.readouterr().out)

    tauri_chunks = [c for c in payload["chunks"] if c["path"] == "STACKS/tauri.md"]
    assert tauri_chunks, "edited note shipped no chunks"
    assert any("Freshly edited chunk body marker" in c["text"] for c in tauri_chunks)
    assert all(c["mtime_ns"] == bumped for c in tauri_chunks)


def test_cli_dump_never_creates_a_vector_set(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """ensure_fresh(semantic=False) refreshes vectors only where they already
    exist — a dump against a never-embedded vault must not build a first set."""
    vault = _make_vault(tmp_path / "vault")  # FTS only, no index_vectors

    cli.main(["json-dump-index", "--vault", str(vault)])
    payload = json.loads(capsys.readouterr().out)

    assert payload["embedder"] is None
    assert payload["chunks"] == []

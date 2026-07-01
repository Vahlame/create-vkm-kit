from __future__ import annotations

from pathlib import Path

from obsidian_memory_rag.embeddings import (
    HashingEmbedder,
    _fastembed_cache_dir,
    _fastembed_identity,
    get_embedder,
    resolve_embedder_name,
)


def test_fastembed_identity_folds_major_minor_version() -> None:
    name = _fastembed_identity("sentence-transformers/some-model")
    # Identity carries the model AND a fastembed version tag, so a pooling-changing
    # upgrade becomes a new identity (no cross-version vector comparison).
    assert name.startswith("fastembed:sentence-transformers/some-model@fe")
    tag = name.split("@fe", 1)[1]
    assert tag.count(".") <= 1  # MAJOR.MINOR only — never the full patch version


def test_fastembed_cache_dir_honors_env(monkeypatch, tmp_path) -> None:
    target = tmp_path / "fe-models"
    monkeypatch.setenv("OBSIDIAN_MEMORY_FASTEMBED_CACHE", str(target))
    out = _fastembed_cache_dir()
    assert Path(out) == target
    assert target.is_dir()  # created on resolve, never assumed to pre-exist


def test_fastembed_cache_dir_default_is_durable_not_temp(monkeypatch) -> None:
    # The whole point of the override is to escape the volatile OS temp dir that
    # fastembed defaults to; the durable default lives under the user's home.
    monkeypatch.delenv("OBSIDIAN_MEMORY_FASTEMBED_CACHE", raising=False)
    out = _fastembed_cache_dir()
    assert str(Path.home()) in out
    assert "obsidian-memory-rag" in out


def test_get_embedder_default_is_dependency_free_hashing(monkeypatch) -> None:
    monkeypatch.delenv("OBSIDIAN_MEMORY_EMBEDDER", raising=False)
    assert isinstance(get_embedder(), HashingEmbedder)


def test_resolve_embedder_name_matches_get_embedder_for_hashing() -> None:
    # The cheap path (hashing) is safe to instantiate for real, so assert exact
    # parity with what get_embedder(...).name actually produces.
    assert resolve_embedder_name("hashing") == get_embedder("hashing").name
    assert resolve_embedder_name("hashing-64") == get_embedder("hashing-64").name


def test_resolve_embedder_name_matches_fastembed_identity_without_loading_model() -> None:
    # For fastembed, resolve_embedder_name must NOT construct FastEmbedEmbedder (that
    # loads an ONNX model) — it should compute the exact same identity string that
    # get_embedder(...).name would, via the same _fastembed_identity helper.
    assert resolve_embedder_name("fastembed:some/model") == _fastembed_identity("some/model")
    assert resolve_embedder_name("fastembed") == _fastembed_identity("BAAI/bge-small-en-v1.5")


def test_resolve_embedder_name_rejects_unknown_choice() -> None:
    try:
        resolve_embedder_name("not-a-real-embedder")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for an unknown embedder choice")

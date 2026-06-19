from __future__ import annotations

from pathlib import Path

from obsidian_memory_rag.embeddings import (
    HashingEmbedder,
    _fastembed_cache_dir,
    _fastembed_identity,
    get_embedder,
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

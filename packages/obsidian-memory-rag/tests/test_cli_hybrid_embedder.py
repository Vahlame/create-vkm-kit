"""Regression coverage for the CLI-layer embedder-identity split-brain: the
hybrid-search/json-hybrid-search handlers used to pre-resolve an embedder via
get_embedder(args.embedder) BEFORE calling ensure_fresh, bypassing its
on-disk-identity-preference entirely and silently querying a throwaway index
instead of the vault's real one. Exercised through the actual CLI resolution
helper (not just direct ensure_fresh() calls), since that's exactly the layer
where the bug lived."""

from __future__ import annotations

from pathlib import Path

from obsidian_memory_rag import HashingEmbedder, index_vault, index_vectors
from obsidian_memory_rag.cli import _resolve_hybrid_embedder


def _write(vault: Path, rel: str, text: str) -> None:
    fp = vault / rel
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(text, encoding="utf-8")


def test_resolve_hybrid_embedder_prefers_on_disk_identity_over_default(tmp_path: Path) -> None:
    vault = tmp_path / "v"
    _write(vault, "a.md", "# a\n\nsome content about pipelines\n")
    index_vault(vault)
    custom = HashingEmbedder(dim=64)  # non-default dim -> non-default identity
    index_vectors(vault, custom)

    embedder = _resolve_hybrid_embedder(vault, None, no_auto_index=False)
    assert embedder.name == custom.name


def test_resolve_hybrid_embedder_explicit_override_wins(tmp_path: Path) -> None:
    vault = tmp_path / "v"
    _write(vault, "a.md", "# a\n\nsome content about pipelines\n")
    index_vault(vault)
    index_vectors(vault, HashingEmbedder(dim=64))

    embedder = _resolve_hybrid_embedder(vault, "hashing-32", no_auto_index=False)
    assert embedder.name == HashingEmbedder(dim=32).name


def test_resolve_hybrid_embedder_no_auto_index_falls_back_to_explicit_arg(tmp_path: Path) -> None:
    vault = tmp_path / "v"
    _write(vault, "a.md", "# a\n\nsome content about pipelines\n")
    index_vault(vault)
    index_vectors(vault, HashingEmbedder(dim=64))

    embedder = _resolve_hybrid_embedder(vault, None, no_auto_index=True)
    # --no-auto-index skips ensure_fresh entirely, so this is the plain
    # env/default resolution — never crashes, never silently wrong.
    assert embedder is not None

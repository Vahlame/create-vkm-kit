"""Pluggable text embedders for semantic / hybrid retrieval (ADR-0017).

The default embedder is **dependency-free**: a deterministic feature-hashing
vectorizer over word tokens + intra-word character trigrams. It is *lexical* — it
ranks by weighted term overlap, which is already a step beyond substring grep
(relevance ranking, partial-match robustness) but does not capture meaning.
Install the ``[semantic]`` extra to use neural embeddings (``fastembed`` / MiniLM)
that match by meaning; the interface and the rest of the pipeline are identical
either way.

The design mirrors the Go daemon's ``Runner`` seam: a small protocol so the
indexer, vector store, and query layer never hard-depend on a specific model, and
tests can exercise the whole hybrid path with the zero-dependency default.
"""

from __future__ import annotations

import hashlib
import math
import os
import re
from array import array
from importlib.metadata import PackageNotFoundError, version as _pkg_version
from pathlib import Path
from typing import Protocol, Sequence

_TOKEN_RE = re.compile(r"[a-z0-9]+", re.ASCII)
_DEFAULT_DIM = 256


class Embedder(Protocol):
    """Maps texts to fixed-dimension unit vectors (cosine == dot product)."""

    name: str
    dim: int

    def embed(self, texts: Sequence[str]) -> list[array]: ...


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


def _features(text: str) -> list[str]:
    """Word unigrams plus intra-word char trigrams (partial-match robustness)."""
    feats: list[str] = []
    for tok in _tokenize(text):
        feats.append(tok)
        if len(tok) > 3:
            padded = f"#{tok}#"
            for i in range(len(padded) - 2):
                feats.append(padded[i : i + 3])
    return feats


def _hash_feature(feature: str, dim: int) -> tuple[int, float]:
    """Feature-hashing trick: stable bucket index + signed weight.

    Uses BLAKE2b (not Python's salted ``hash()``) so vectors are identical across
    processes and machines — required for an on-disk index that outlives the run.
    """
    digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
    h = int.from_bytes(digest, "little")
    bucket = h % dim
    sign = 1.0 if (h >> 63) & 1 else -1.0
    return bucket, sign


def _l2_normalize(vec: array) -> array:
    """Scale to unit length in place (no-op for the zero vector)."""
    norm = math.sqrt(math.fsum(x * x for x in vec))
    if norm > 0.0:
        inv = 1.0 / norm
        for i in range(len(vec)):
            vec[i] *= inv
    return vec


class HashingEmbedder:
    """Deterministic, dependency-free lexical embedder (feature hashing)."""

    def __init__(self, dim: int = _DEFAULT_DIM) -> None:
        if dim < 16:
            raise ValueError("dim must be >= 16")
        self.name = f"hashing-{dim}"
        self.dim = dim

    def embed(self, texts: Sequence[str]) -> list[array]:
        out: list[array] = []
        for text in texts:
            vec = array("f", bytes(4 * self.dim))  # dim float32 zeros
            for feat in _features(text):
                bucket, sign = _hash_feature(feat, self.dim)
                vec[bucket] += sign
            out.append(_l2_normalize(vec))
        return out


def _fastembed_cache_dir() -> str:
    """Stable on-disk cache for fastembed's ONNX model files.

    fastembed's own default is ``$TMPDIR/fastembed_cache`` (``%LOCALAPPDATA%\\Temp``
    on Windows) — a volatile location that OS temp-cleaners purge, forcing a
    multi-hundred-MB re-download (and a hard failure when offline) on the next
    index. We default to a durable per-user directory instead, overridable with
    ``OBSIDIAN_MEMORY_FASTEMBED_CACHE`` for users who keep models elsewhere.
    """
    override = os.environ.get("OBSIDIAN_MEMORY_FASTEMBED_CACHE", "").strip()
    base = Path(override) if override else Path.home() / ".cache" / "obsidian-memory-rag" / "fastembed"
    base.mkdir(parents=True, exist_ok=True)
    return str(base)


def _fastembed_identity(model: str) -> str:
    """Embedder identity that folds fastembed's MAJOR.MINOR version into the name.

    The vector store keys every chunk by this name and only ever compares a query
    against chunks built by the *same* name (``vector_store.search_chunks``). That
    already isolates different *models*, but not a fastembed upgrade that changes a
    model's pooling/normalization while keeping the model name — e.g. the multilingual
    MiniLM moved from CLS pooling (fastembed 0.5.x) to mean pooling (0.8.x), which
    silently makes vectors built by one version incomparable to queries embedded by
    another. Folding the MAJOR.MINOR version into the identity turns such an upgrade
    into a *new* embedder name, so stored vectors are never cross-compared and
    ``index_vectors`` re-embeds under the new identity automatically on the next run.
    Patch upgrades keep the same MAJOR.MINOR, so they never trigger a needless rebuild.
    """
    try:
        ver = _pkg_version("fastembed")
        tag = ".".join(ver.split(".")[:2]) or ver
    except PackageNotFoundError:  # pragma: no cover - fastembed present if we got here
        tag = "unknown"
    return f"fastembed:{model}@fe{tag}"


class FastEmbedEmbedder:
    """Neural embedder via the optional ``fastembed`` dependency (ONNX, no torch)."""

    def __init__(self, model: str = "BAAI/bge-small-en-v1.5") -> None:
        try:
            from fastembed import TextEmbedding
        except ImportError as exc:  # pragma: no cover - only exercised with the extra
            raise RuntimeError(
                "fastembed is not installed. Install the semantic extra:\n"
                "  pip install 'obsidian-memory-rag[semantic]'"
            ) from exc
        self._model = TextEmbedding(model_name=model, cache_dir=_fastembed_cache_dir())
        self.name = _fastembed_identity(model)
        probe = next(iter(self._model.embed(["dimension probe"])))
        self.dim = len(probe)

    def embed(self, texts: Sequence[str]) -> list[array]:
        out: list[array] = []
        for vec in self._model.embed(list(texts)):
            out.append(_l2_normalize(array("f", (float(x) for x in vec))))
        return out


def resolve_embedder_name(name: str | None = None) -> str:
    """The ``.name`` that :func:`get_embedder` would build, without instantiating it.

    A caller that only needs the identity string (e.g. to filter ``note_chunks`` by
    embedder) should use this instead of ``get_embedder(name).name`` — constructing a
    ``FastEmbedEmbedder`` loads its ONNX model into memory, which is wasted work if
    the model itself is never used to embed anything.
    """
    choice = (name or os.environ.get("OBSIDIAN_MEMORY_EMBEDDER") or "hashing").strip()
    if choice in ("hashing", "default", ""):
        return HashingEmbedder().name
    if choice.startswith("hashing-"):
        return HashingEmbedder(int(choice.split("-", 1)[1])).name
    if choice in ("fastembed", "neural", "semantic"):
        return _fastembed_identity("BAAI/bge-small-en-v1.5")
    if choice.startswith("fastembed:"):
        return _fastembed_identity(choice.split(":", 1)[1])
    raise ValueError(f"unknown embedder: {choice!r}")


def get_embedder(name: str | None = None) -> Embedder:
    """Resolve an embedder by explicit name or the ``OBSIDIAN_MEMORY_EMBEDDER`` env.

    - ``hashing`` (default) / ``hashing-<dim>`` — zero-dependency lexical embedder.
    - ``fastembed`` / ``fastembed:<model>`` — neural; requires the ``[semantic]``
      extra and raises a clear error if it is missing.
    """
    choice = (name or os.environ.get("OBSIDIAN_MEMORY_EMBEDDER") or "hashing").strip()
    if choice in ("hashing", "default", ""):
        return HashingEmbedder()
    if choice.startswith("hashing-"):
        return HashingEmbedder(int(choice.split("-", 1)[1]))
    if choice in ("fastembed", "neural", "semantic"):
        return FastEmbedEmbedder()
    if choice.startswith("fastembed:"):
        return FastEmbedEmbedder(choice.split(":", 1)[1])
    raise ValueError(f"unknown embedder: {choice!r}")

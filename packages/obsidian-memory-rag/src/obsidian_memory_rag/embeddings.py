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
        self._model = TextEmbedding(model_name=model)
        self.name = f"fastembed:{model}"
        probe = next(iter(self._model.embed(["dimension probe"])))
        self.dim = len(probe)

    def embed(self, texts: Sequence[str]) -> list[array]:
        out: list[array] = []
        for vec in self._model.embed(list(texts)):
            out.append(_l2_normalize(array("f", (float(x) for x in vec))))
        return out


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

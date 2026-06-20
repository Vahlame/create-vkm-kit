"""Optional cross-encoder reranker for hybrid retrieval (ADR-0026).

The semantic embedder is a *bi-encoder*: it embeds the query and each passage
independently, then compares vectors. A **cross-encoder** instead scores the query
and a passage *together* in one forward pass, so it judges "is THIS passage the
answer to THIS query?" far more precisely — at the cost of one model run per
candidate. So it reranks only the small fused candidate pool (never the whole
vault), as a final precision pass on top of BM25 ⊕ vector ⊕ graph fusion.

It is entirely optional and **off by default**: the deterministic retrieval path is
unchanged and this module is only imported when reranking is requested. The design
mirrors :mod:`.embeddings` — a :class:`Reranker` protocol plus a ``fastembed``
implementation behind the ``[rerank]`` extra, a durable shared model cache, and a
version-folded identity. Cross-encoder scores are **relative logits**: comparable
to order passages within one query, not calibrated across queries.
"""

from __future__ import annotations

import os
from typing import Protocol, Sequence

from .embeddings import _fastembed_cache_dir, _fastembed_identity

# Multilingual by default — the kit's vaults are frequently Spanish. Override with
# OBSIDIAN_MEMORY_RERANK_MODEL (e.g. a smaller English-only MiniLM cross-encoder
# such as "Xenova/ms-marco-MiniLM-L-6-v2" for a lighter, faster footprint).
DEFAULT_RERANK_MODEL = "jinaai/jina-reranker-v2-base-multilingual"

_TRUTHY = frozenset({"1", "true", "on", "yes"})
_FALSY = frozenset({"", "0", "false", "off", "no"})


class Reranker(Protocol):
    """Scores query–passage pairs jointly; higher logit = more relevant."""

    name: str

    def rerank(self, query: str, passages: Sequence[str]) -> list[float]:
        """Return one relative logit per passage, order-aligned with the input."""
        ...


class FastEmbedReranker:
    """Cross-encoder reranker via the optional ``fastembed`` dependency (ONNX, no torch)."""

    def __init__(self, model: str = DEFAULT_RERANK_MODEL) -> None:
        try:
            from fastembed.rerank.cross_encoder import TextCrossEncoder
        except ImportError as exc:  # pragma: no cover - only exercised with the extra
            raise RuntimeError(
                "fastembed reranker is not installed. Install the rerank extra:\n"
                "  pip install 'obsidian-memory-rag[rerank]'"
            ) from exc
        self._model = TextCrossEncoder(model_name=model, cache_dir=_fastembed_cache_dir())
        # Reuse the embedder identity helper, retagged so a reranker model can never
        # be confused with an embedding model of the same name.
        self.name = _fastembed_identity(model).replace("fastembed:", "fastembed-rerank:", 1)

    def rerank(self, query: str, passages: Sequence[str]) -> list[float]:
        passages = list(passages)
        if not passages:
            return []
        return [float(s) for s in self._model.rerank(query, passages)]


def get_reranker(name: str | None = None) -> "Reranker | None":
    """Resolve a reranker, or ``None`` when reranking is disabled (the default).

    - ``name is None`` → read the environment: enabled only if
      ``OBSIDIAN_MEMORY_RERANK`` is truthy, using ``OBSIDIAN_MEMORY_RERANK_MODEL``
      (or the multilingual default).
    - a falsy token (``""``/``0``/``off``/``no``) → ``None``.
    - a model id (contains ``/``) → that model.
    - any other truthy token (e.g. ``"1"``) → the env/default model.

    Returns ``None`` (never raises) when disabled so callers no-op cleanly; an
    *enabled* call with the extra missing raises a clear install hint.
    """
    model_env = os.environ.get("OBSIDIAN_MEMORY_RERANK_MODEL", "").strip()
    if name is None:
        if (os.environ.get("OBSIDIAN_MEMORY_RERANK", "").strip().lower()) not in _TRUTHY:
            return None
        return FastEmbedReranker(model_env or DEFAULT_RERANK_MODEL)
    choice = name.strip()
    if choice.lower() in _FALSY:
        return None
    if "/" in choice:  # an explicit model id
        return FastEmbedReranker(choice)
    return FastEmbedReranker(model_env or DEFAULT_RERANK_MODEL)

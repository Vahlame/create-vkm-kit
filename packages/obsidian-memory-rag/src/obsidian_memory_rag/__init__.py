"""Optional hybrid RAG for Obsidian-style vaults."""

from .audit import audit_vault
from .embeddings import Embedder, HashingEmbedder, get_embedder
from .indexer import (
    FreshStats,
    IndexStats,
    VectorStats,
    ensure_fresh,
    index_vault,
    index_vectors,
)
from .query import HybridHit, SearchHit, hybrid_search, search_vault, semantic_search
from .rotate import RotateResult, rotate_session_log
from .vector_store import ChunkHit

__all__ = [
    "ChunkHit",
    "Embedder",
    "FreshStats",
    "HashingEmbedder",
    "HybridHit",
    "IndexStats",
    "RotateResult",
    "SearchHit",
    "VectorStats",
    "audit_vault",
    "ensure_fresh",
    "get_embedder",
    "hybrid_search",
    "index_vault",
    "index_vectors",
    "rotate_session_log",
    "search_vault",
    "semantic_search",
]

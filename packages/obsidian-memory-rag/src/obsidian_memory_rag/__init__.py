"""Optional hybrid RAG for Obsidian-style vaults."""

from .audit import audit_vault
from .complete import build_completion_trie, complete
from .embeddings import Embedder, HashingEmbedder, get_embedder
from .indexer import (
    FreshStats,
    IndexStats,
    VectorStats,
    ensure_fresh,
    index_vault,
    index_vectors,
)
from .query import (
    HybridHit,
    SearchHit,
    graph_neighbors,
    hybrid_search,
    search_vault,
    semantic_search,
)
from .rotate import RotateResult, rotate_session_log
from .trie import Trie
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
    "Trie",
    "VectorStats",
    "audit_vault",
    "build_completion_trie",
    "complete",
    "ensure_fresh",
    "get_embedder",
    "graph_neighbors",
    "hybrid_search",
    "index_vault",
    "index_vectors",
    "rotate_session_log",
    "search_vault",
    "semantic_search",
]

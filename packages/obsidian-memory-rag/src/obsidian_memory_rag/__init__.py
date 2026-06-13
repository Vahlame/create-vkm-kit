"""Optional hybrid RAG for Obsidian-style vaults."""

from .embeddings import Embedder, HashingEmbedder, get_embedder
from .indexer import IndexStats, VectorStats, index_vault, index_vectors
from .query import HybridHit, SearchHit, hybrid_search, search_vault, semantic_search
from .vector_store import VectorHit

__all__ = [
    "Embedder",
    "HashingEmbedder",
    "HybridHit",
    "IndexStats",
    "SearchHit",
    "VectorHit",
    "VectorStats",
    "get_embedder",
    "hybrid_search",
    "index_vault",
    "index_vectors",
    "search_vault",
    "semantic_search",
]

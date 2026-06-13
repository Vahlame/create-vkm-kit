"""Optional hybrid RAG for Obsidian-style vaults."""

from .embeddings import Embedder, HashingEmbedder, get_embedder
from .indexer import IndexStats, VectorStats, index_vault, index_vectors
from .query import HybridHit, SearchHit, hybrid_search, search_vault, semantic_search
from .vector_store import ChunkHit

__all__ = [
    "ChunkHit",
    "Embedder",
    "HashingEmbedder",
    "HybridHit",
    "IndexStats",
    "SearchHit",
    "VectorStats",
    "get_embedder",
    "hybrid_search",
    "index_vault",
    "index_vectors",
    "search_vault",
    "semantic_search",
]

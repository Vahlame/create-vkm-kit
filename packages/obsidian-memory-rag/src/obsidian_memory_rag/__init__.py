"""Optional hybrid RAG for Obsidian-style vaults."""

from .audit import audit_vault
from .bench_recall import (
    BenchReport,
    QueryResult,
    evaluate,
    load_queries,
    run_benchmark,
)
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
    "BenchReport",
    "ChunkHit",
    "Embedder",
    "FreshStats",
    "HashingEmbedder",
    "HybridHit",
    "IndexStats",
    "QueryResult",
    "RotateResult",
    "SearchHit",
    "Trie",
    "VectorStats",
    "audit_vault",
    "build_completion_trie",
    "complete",
    "ensure_fresh",
    "evaluate",
    "get_embedder",
    "graph_neighbors",
    "hybrid_search",
    "index_vault",
    "index_vectors",
    "load_queries",
    "rotate_session_log",
    "run_benchmark",
    "search_vault",
    "semantic_search",
]

"""Optional hybrid RAG for Obsidian-style vaults."""

from .audit import audit_vault
from .bench_assemble import (
    AssembleBenchReport,
    AssembleQueryResult,
    evaluate_assemble,
    run_assemble_benchmark,
)
from .bench_recall import (
    BenchReport,
    QueryResult,
    evaluate,
    load_queries,
    run_benchmark,
)
from .bench_tokens import (
    TokenBenchReport,
    TokenQueryResult,
    estimate_tokens,
    evaluate_tokens,
    run_token_benchmark,
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
from .kg_query import (
    ObservationHit,
    RelationHit,
    observations_query,
    relations_for,
    suggest_structure,
)
from .knowledge_graph import (
    Observation,
    Relation,
    parse_observations,
    parse_relations,
)
from .query import (
    HybridHit,
    SearchHit,
    graph_neighbors,
    hybrid_search,
    search_vault,
    semantic_search,
    typed_graph_neighbors,
)
from .report import build_report
from .rerank import FastEmbedReranker, Reranker, get_reranker
from .rotate import RotateResult, rotate_session_log
from .trie import Trie
from .vector_store import ChunkHit

__all__ = [
    "AssembleBenchReport",
    "AssembleQueryResult",
    "BenchReport",
    "ChunkHit",
    "Embedder",
    "FastEmbedReranker",
    "FreshStats",
    "HashingEmbedder",
    "HybridHit",
    "IndexStats",
    "Observation",
    "ObservationHit",
    "QueryResult",
    "Relation",
    "RelationHit",
    "Reranker",
    "RotateResult",
    "SearchHit",
    "TokenBenchReport",
    "TokenQueryResult",
    "Trie",
    "VectorStats",
    "audit_vault",
    "build_completion_trie",
    "build_report",
    "complete",
    "ensure_fresh",
    "estimate_tokens",
    "evaluate",
    "evaluate_assemble",
    "evaluate_tokens",
    "get_embedder",
    "get_reranker",
    "graph_neighbors",
    "hybrid_search",
    "index_vault",
    "index_vectors",
    "load_queries",
    "observations_query",
    "parse_observations",
    "parse_relations",
    "relations_for",
    "rotate_session_log",
    "run_assemble_benchmark",
    "run_benchmark",
    "run_token_benchmark",
    "search_vault",
    "semantic_search",
    "suggest_structure",
    "typed_graph_neighbors",
]

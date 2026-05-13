"""Optional hybrid RAG for Obsidian-style vaults."""

from .indexer import IndexStats, index_vault
from .query import SearchHit, search_vault

__all__ = ["IndexStats", "SearchHit", "index_vault", "search_vault"]

"""CLI for local FTS5 + hybrid vault search (optional hybrid RAG sidecar, ADR-0014/0017)."""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

from .audit import audit_vault
from .complete import complete as complete_prefix
from .embeddings import get_embedder
from .indexer import ensure_fresh, index_vault, index_vectors
from .query import hybrid_search, search_vault
from .rotate import rotate_session_log


def main() -> None:
    # The Node MCP bridge consumes this CLI's stdout, and vault content is often
    # non-ASCII (e.g. Spanish notes). Force UTF-8 so json.dumps(ensure_ascii=False)
    # and snippet printing never crash under a legacy console codepage (cp1252 on
    # Windows). Guarded because captured streams (pytest) lack reconfigure().
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    p = argparse.ArgumentParser(prog="obsidian-memory-rag")
    sub = p.add_subparsers(dest="cmd", required=True)

    ix = sub.add_parser("index", help="Incremental FTS5 index for *.md under a vault")
    ix.add_argument("--vault", type=Path, required=True, help="Vault root (git repo or folder)")
    ix.add_argument(
        "--max-file-bytes",
        type=int,
        default=1_048_576,
        help="Max bytes read per note (default 1 MiB)",
    )
    ix.add_argument(
        "--semantic",
        action="store_true",
        help="Also build note embeddings for hybrid search",
    )
    ix.add_argument(
        "--embedder",
        default=None,
        help="Embedder name (default: hashing; 'fastembed' needs the [semantic] extra)",
    )

    q = sub.add_parser("search", help="BM25-ranked search over indexed vault")
    q.add_argument("--vault", type=Path, required=True)
    q.add_argument("query", help="Space-separated terms (AND semantics on body)")
    q.add_argument("--limit", type=int, default=20)
    q.add_argument(
        "--no-auto-index",
        action="store_true",
        help="Skip the pre-search incremental index refresh (query the index as-is)",
    )

    hs = sub.add_parser(
        "hybrid-search",
        help="Hybrid BM25 + semantic vector search (relevance-ranked)",
    )
    hs.add_argument("--vault", type=Path, required=True)
    hs.add_argument("query", help="Natural-language query (ranked by relevance, not just keywords)")
    hs.add_argument("--limit", type=int, default=20)
    hs.add_argument("--embedder", default=None)
    hs.add_argument(
        "--graph",
        action="store_true",
        help="Also fuse in notes adjacent in the [[wikilink]] graph (link-aware recall)",
    )
    hs.add_argument(
        "--no-auto-index",
        action="store_true",
        help="Skip the pre-search incremental index refresh (query the index as-is)",
    )

    b = sub.add_parser("bench", help="Micro-benchmark repeated search (local perf smoke)")
    b.add_argument("--vault", type=Path, required=True)
    b.add_argument("--query", default="memory")
    b.add_argument("--iterations", type=int, default=200)
    b.add_argument("--limit", type=int, default=10)

    js = sub.add_parser(
        "json-search",
        help="Print BM25 hits as one JSON object (for MCP / scripting)",
    )
    js.add_argument("--vault", type=Path, required=True)
    js.add_argument("--query", required=True)
    js.add_argument("--limit", type=int, default=20)
    js.add_argument(
        "--no-auto-index",
        action="store_true",
        help="Skip the pre-search incremental index refresh (query the index as-is)",
    )

    jh = sub.add_parser(
        "json-hybrid-search",
        help="Print hybrid (BM25 + vector) hits as one JSON object (for MCP)",
    )
    jh.add_argument("--vault", type=Path, required=True)
    jh.add_argument("--query", required=True)
    jh.add_argument("--limit", type=int, default=20)
    jh.add_argument("--embedder", default=None)
    jh.add_argument(
        "--graph",
        action="store_true",
        help="Also fuse in notes adjacent in the [[wikilink]] graph (link-aware recall)",
    )
    jh.add_argument(
        "--no-auto-index",
        action="store_true",
        help="Skip the pre-search incremental index refresh (query the index as-is)",
    )

    ji = sub.add_parser(
        "json-index",
        help="Run incremental index; print stats as one JSON object",
    )
    ji.add_argument("--vault", type=Path, required=True)
    ji.add_argument(
        "--max-file-bytes",
        type=int,
        default=1_048_576,
    )
    ji.add_argument(
        "--semantic",
        action="store_true",
        help="Also build note embeddings for hybrid search",
    )
    ji.add_argument("--embedder", default=None)

    au = sub.add_parser(
        "audit",
        help="Human-readable vault health report (sizes, broken links, SESSION_LOG)",
    )
    au.add_argument("--vault", type=Path, required=True)
    au.add_argument(
        "--budget",
        type=int,
        default=8000,
        help="Per-note token budget; notes above it are flagged (default 8000)",
    )

    ja = sub.add_parser(
        "json-audit",
        help="Print the vault health report as one JSON object (for MCP)",
    )
    ja.add_argument("--vault", type=Path, required=True)
    ja.add_argument("--budget", type=int, default=8000)

    rl = sub.add_parser(
        "rotate-log",
        help="Archive old SESSION_LOG.md sections, keeping the newest N",
    )
    rl.add_argument("--vault", type=Path, required=True)
    rl.add_argument(
        "--keep",
        type=int,
        default=8,
        help="Number of most-recent sections to keep in SESSION_LOG.md (default 8)",
    )
    rl.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would move without writing any file",
    )

    cp = sub.add_parser(
        "complete",
        help="Prefix autocomplete over note titles, filenames and inline #tags (Trie)",
    )
    cp.add_argument("--vault", type=Path, required=True)
    cp.add_argument("prefix", help="Prefix to complete (case-insensitive)")
    cp.add_argument("--limit", type=int, default=20)
    cp.add_argument(
        "--no-auto-index",
        action="store_true",
        help="Skip the pre-search incremental index refresh (query the index as-is)",
    )

    jcp = sub.add_parser(
        "json-complete",
        help="Print autocomplete matches as one JSON object (for MCP)",
    )
    jcp.add_argument("--vault", type=Path, required=True)
    jcp.add_argument("--prefix", required=True)
    jcp.add_argument("--limit", type=int, default=20)
    jcp.add_argument(
        "--no-auto-index",
        action="store_true",
        help="Skip the pre-search incremental index refresh (query the index as-is)",
    )

    args = p.parse_args()
    if args.cmd == "index":
        stats = index_vault(args.vault, max_file_bytes=args.max_file_bytes)
        print(
            "index done:",
            f"scanned={stats.scanned}",
            f"inserted={stats.inserted}",
            f"updated={stats.updated}",
            f"skipped={stats.skipped_unchanged}",
            f"removed={stats.removed}",
            f"truncated={stats.truncated}",
        )
        if args.semantic:
            vstats = index_vectors(
                args.vault, get_embedder(args.embedder), max_file_bytes=args.max_file_bytes
            )
            print(
                "vectors done:",
                f"scanned={vstats.scanned}",
                f"embedded={vstats.embedded}",
                f"chunks={vstats.chunks}",
                f"skipped={vstats.skipped_unchanged}",
                f"removed={vstats.removed}",
            )
    elif args.cmd == "search":
        if not args.no_auto_index:
            ensure_fresh(args.vault)
        hits = search_vault(args.vault, args.query, limit=args.limit)
        if not hits:
            print("no hits (run `index` first or broaden query)")
            return
        for h in hits:
            print(f"{h.path}\tbm25={h.bm25:.4f}\t{h.title!r}")
            print(f"  {h.snippet}")
    elif args.cmd == "hybrid-search":
        embedder = get_embedder(args.embedder)
        if not args.no_auto_index:
            ensure_fresh(args.vault, embedder=embedder)
        hits = hybrid_search(args.vault, args.query, embedder, limit=args.limit, graph=args.graph)
        if not hits:
            print("no hits (run `index --semantic` first or broaden query)")
            return
        for h in hits:
            label = f"[{h.heading}]" if h.heading else ""
            print(
                f"{h.path}\trrf={h.score:.5f}\t"
                f"bm25={h.bm25_rank} vec={h.vector_rank} graph={h.graph_rank}\t{label}"
            )
            if h.snippet:
                print(f"  {h.snippet}")
    elif args.cmd == "bench":
        hits = search_vault(args.vault, args.query, limit=args.limit)
        if not hits:
            print("no hits: index the vault and use a query that matches content")
            raise SystemExit(2)
        lat: list[float] = []
        for _ in range(args.iterations):
            t0 = time.perf_counter()
            _ = search_vault(args.vault, args.query, limit=args.limit)
            lat.append((time.perf_counter() - t0) * 1000.0)
        lat.sort()
        p50 = statistics.median(lat)
        p95 = lat[int(0.95 * (len(lat) - 1))]
        print(f"iterations={args.iterations} query={args.query!r} limit={args.limit}")
        print(f"latency_ms p50={p50:.3f} p95={p95:.3f} min={lat[0]:.3f} max={lat[-1]:.3f}")
    elif args.cmd == "json-search":
        if not args.no_auto_index:
            ensure_fresh(args.vault)
        hits = search_vault(args.vault, args.query, limit=args.limit)
        payload = {
            "hits": [
                {
                    "path": h.path,
                    "title": h.title,
                    "snippet": h.snippet,
                    "bm25": h.bm25,
                    "mtime_ns": h.mtime_ns,
                }
                for h in hits
            ],
            "count": len(hits),
        }
        print(json.dumps(payload, ensure_ascii=False))
    elif args.cmd == "json-hybrid-search":
        embedder = get_embedder(args.embedder)
        if not args.no_auto_index:
            ensure_fresh(args.vault, embedder=embedder)
        hits = hybrid_search(args.vault, args.query, embedder, limit=args.limit, graph=args.graph)
        payload = {
            "hits": [
                {
                    "path": h.path,
                    "heading": h.heading,
                    "snippet": h.snippet,
                    "score": h.score,
                    "bm25_rank": h.bm25_rank,
                    "vector_rank": h.vector_rank,
                    "graph_rank": h.graph_rank,
                }
                for h in hits
            ],
            "count": len(hits),
        }
        print(json.dumps(payload, ensure_ascii=False))
    elif args.cmd == "json-index":
        stats = index_vault(args.vault, max_file_bytes=args.max_file_bytes)
        payload: dict = {
            "scanned": stats.scanned,
            "inserted": stats.inserted,
            "updated": stats.updated,
            "skipped_unchanged": stats.skipped_unchanged,
            "removed": stats.removed,
            "truncated": stats.truncated,
        }
        if args.semantic:
            vstats = index_vectors(
                args.vault, get_embedder(args.embedder), max_file_bytes=args.max_file_bytes
            )
            payload["vectors"] = {
                "scanned": vstats.scanned,
                "embedded": vstats.embedded,
                "chunks": vstats.chunks,
                "skipped_unchanged": vstats.skipped_unchanged,
                "removed": vstats.removed,
            }
        print(json.dumps(payload, ensure_ascii=False))
    elif args.cmd == "audit":
        report = audit_vault(args.vault, budget_tokens=args.budget)
        totals = report["totals"]
        print(
            f"audit: notes={totals['notes']} tokens~={totals['tokens']} "
            f"budget={report['budget_tokens']}"
        )
        oversized = report["oversized"]
        print(f"oversized ({len(oversized)}):")
        for item in oversized:
            print(f"  {item['path']}\t{item['tokens']} tokens")
        broken = report["broken_links"]
        print(f"broken_links ({len(broken)}):")
        for item in broken:
            print(f"  {item['source']} -> [[{item['target']}]]")
        sl = report["session_log"]
        if sl is None:
            print("session_log: (none)")
        else:
            flag = " OVER THRESHOLD" if sl["over_threshold"] else ""
            print(f"session_log: {sl['path']} {sl['tokens']} tokens{flag}")
    elif args.cmd == "json-audit":
        report = audit_vault(args.vault, budget_tokens=args.budget)
        print(json.dumps(report, ensure_ascii=False))
    elif args.cmd == "rotate-log":
        res = rotate_session_log(args.vault, keep=args.keep, dry_run=args.dry_run)
        prefix = "rotate-log (dry-run):" if args.dry_run else "rotate-log:"
        print(
            f"{prefix} sections={res.sections_total} kept={res.kept} "
            f"archived={res.archived} archive={res.archive_path}"
        )
    elif args.cmd == "complete":
        if not args.no_auto_index:
            ensure_fresh(args.vault)
        matches = complete_prefix(args.vault, args.prefix, limit=args.limit)
        if not matches:
            print("no completions (index the vault or try a shorter prefix)")
            return
        for m in matches:
            print(m)
    elif args.cmd == "json-complete":
        if not args.no_auto_index:
            ensure_fresh(args.vault)
        matches = complete_prefix(args.vault, args.prefix, limit=args.limit)
        print(
            json.dumps(
                {"prefix": args.prefix, "matches": matches, "count": len(matches)},
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()

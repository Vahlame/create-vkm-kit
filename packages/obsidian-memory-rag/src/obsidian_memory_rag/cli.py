"""CLI for local FTS5 vault search (optional hybrid RAG sidecar, ADR-0014)."""

from __future__ import annotations

import argparse
import statistics
import time
from pathlib import Path

from .indexer import index_vault
from .query import search_vault


def main() -> None:
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

    q = sub.add_parser("search", help="BM25-ranked search over indexed vault")
    q.add_argument("--vault", type=Path, required=True)
    q.add_argument("query", help="Space-separated terms (AND semantics on body)")
    q.add_argument("--limit", type=int, default=20)

    b = sub.add_parser("bench", help="Micro-benchmark repeated search (local perf smoke)")
    b.add_argument("--vault", type=Path, required=True)
    b.add_argument("--query", default="memory")
    b.add_argument("--iterations", type=int, default=200)
    b.add_argument("--limit", type=int, default=10)

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
    elif args.cmd == "search":
        hits = search_vault(args.vault, args.query, limit=args.limit)
        if not hits:
            print("no hits (run `index` first or broaden query)")
            return
        for h in hits:
            print(f"{h.path}\tbm25={h.bm25:.4f}\t{h.title!r}")
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


if __name__ == "__main__":
    main()

"""CLI for local FTS5 + hybrid vault search (optional hybrid RAG sidecar, ADR-0014/0017)."""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

from .audit import audit_vault
from .bench_recall import format_report, run_benchmark
from .complete import complete as complete_prefix
from .embeddings import get_embedder
from .indexer import ensure_fresh, index_vault, index_vectors
from .kg_query import observations_query, relations_for, suggest_structure
from .query import hybrid_search, search_vault
from .report import build_report
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
        "--recency",
        action="store_true",
        help="Bias ranking toward recently-modified notes (exponential time decay)",
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

    for name, helptext in (
        ("bench-recall", "Measure retrieval quality (recall@k / MRR / hit@1) vs a labelled corpus"),
        ("json-bench-recall", "Same as bench-recall but print one JSON object (for scripting)"),
    ):
        br = sub.add_parser(name, help=helptext)
        br.add_argument("--corpus", type=Path, required=True, help="Folder of Markdown notes")
        br.add_argument("--queries", type=Path, required=True, help="JSONL: {query, relevant, kind?}")
        br.add_argument("--k", type=int, default=5)
        br.add_argument("--embedder", default=None)
        br.add_argument("--graph", action="store_true", help="Fuse in [[wikilink]] neighbours")
        br.add_argument(
            "--in-place",
            action="store_true",
            help="Index the corpus where it lives (default: copy to a temp dir first)",
        )
        # Optional CI gates: exit non-zero if a metric falls below the threshold.
        br.add_argument("--assert-recall", type=float, default=None)
        br.add_argument("--assert-mrr", type=float, default=None)
        br.add_argument("--assert-hit1", type=float, default=None)
        br.add_argument("--assert-ndcg", type=float, default=None)
        br.add_argument("--assert-map", type=float, default=None)

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
        "--recency",
        action="store_true",
        help="Bias ranking toward recently-modified notes (exponential time decay)",
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

    # --- Knowledge graph (ADR-0023): typed relations + structured observations ---
    for name, helptext in (
        ("relations", "Typed [[wikilink]] relations touching a note (in/out/both)"),
        ("json-relations", "Same as relations but print one JSON object (for MCP)"),
    ):
        rp = sub.add_parser(name, help=helptext)
        rp.add_argument("--vault", type=Path, required=True)
        rp.add_argument("note", help="Note path or bare name (resolved Obsidian-style)")
        rp.add_argument(
            "--direction",
            choices=("out", "in", "both"),
            default="both",
            help="out = this note's edges; in = notes linking here; both (default)",
        )
        rp.add_argument("--limit", type=int, default=200)
        rp.add_argument("--no-auto-index", action="store_true")

    for name, helptext in (
        ("observations", "Structured observations filtered by category / tag / note"),
        ("json-observations", "Same as observations but print one JSON object (for MCP)"),
    ):
        op = sub.add_parser(name, help=helptext)
        op.add_argument("--vault", type=Path, required=True)
        op.add_argument("--category", default=None, help="Exact category, e.g. decision")
        op.add_argument("--tag", default=None, help="Whole #tag (without the #)")
        op.add_argument("--note", default=None, help="Restrict to one source note")
        op.add_argument("--limit", type=int, default=200)
        op.add_argument("--no-auto-index", action="store_true")

    for name, helptext in (
        ("kg-suggest", "Read-only: a note's structure + relation/observation candidates"),
        ("json-kg-suggest", "Same as kg-suggest but print one JSON object (for MCP)"),
    ):
        sp = sub.add_parser(name, help=helptext)
        sp.add_argument("--vault", type=Path, required=True)
        sp.add_argument("note", help="Note path or bare name to inspect")
        sp.add_argument("--no-auto-index", action="store_true")

    for name, helptext in (
        ("memory-report", "Read-only digest: indices, hygiene + compaction candidates"),
        ("json-memory-report", "Same as memory-report but print one JSON object (for MCP)"),
    ):
        mr = sub.add_parser(name, help=helptext)
        mr.add_argument("--vault", type=Path, required=True)
        mr.add_argument("--budget", type=int, default=8000, help="Per-note token budget")
        mr.add_argument(
            "--stale-days",
            type=float,
            default=180.0,
            help="Notes untouched this many days are flagged stale (default 180)",
        )
        mr.add_argument(
            "--duplicates",
            action="store_true",
            help="Also surface near-duplicate note pairs (needs embeddings)",
        )
        mr.add_argument(
            "--similarity",
            type=float,
            default=0.92,
            help="Cosine threshold for near-duplicate pairs (default 0.92)",
        )
        mr.add_argument("--no-auto-index", action="store_true")

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
            f"relations={stats.relations}",
            f"observations={stats.observations}",
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
        hits = hybrid_search(
            args.vault, args.query, embedder, limit=args.limit, graph=args.graph,
            recency=args.recency,
        )
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
    elif args.cmd in ("bench-recall", "json-bench-recall"):
        report = run_benchmark(
            args.corpus,
            args.queries,
            k=args.k,
            embedder_name=args.embedder,
            graph=args.graph,
            in_place=args.in_place,
        )
        if args.cmd == "json-bench-recall":
            print(json.dumps(report.to_dict(), ensure_ascii=False))
        else:
            print(format_report(report))
        # Optional gates (used by CI to fail on a retrieval-quality regression).
        failures: list[str] = []
        if args.assert_recall is not None and report.recall_at_k < args.assert_recall:
            failures.append(f"recall@{report.k} {report.recall_at_k:.3f} < {args.assert_recall}")
        if args.assert_mrr is not None and report.mrr < args.assert_mrr:
            failures.append(f"MRR {report.mrr:.3f} < {args.assert_mrr}")
        if args.assert_hit1 is not None and report.hit_at_1 < args.assert_hit1:
            failures.append(f"hit@1 {report.hit_at_1:.3f} < {args.assert_hit1}")
        if args.assert_ndcg is not None and report.ndcg_at_k < args.assert_ndcg:
            failures.append(f"nDCG@{report.k} {report.ndcg_at_k:.3f} < {args.assert_ndcg}")
        if args.assert_map is not None and report.map < args.assert_map:
            failures.append(f"MAP {report.map:.3f} < {args.assert_map}")
        if failures:
            print("RETRIEVAL GATE FAILED: " + "; ".join(failures), file=sys.stderr)
            raise SystemExit(1)
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
        hits = hybrid_search(
            args.vault, args.query, embedder, limit=args.limit, graph=args.graph,
            recency=args.recency,
        )
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
            "relations": stats.relations,
            "observations": stats.observations,
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
    elif args.cmd in ("relations", "json-relations"):
        if not args.no_auto_index:
            ensure_fresh(args.vault)
        hits = relations_for(
            args.vault, args.note, direction=args.direction, limit=args.limit
        )
        if args.cmd == "json-relations":
            print(
                json.dumps(
                    {
                        "note": args.note,
                        "direction": args.direction,
                        "relations": [
                            {
                                "source_path": h.source_path,
                                "relation_type": h.relation_type,
                                "target": h.target,
                                "target_path": h.target_path,
                                "context": h.context,
                                "direction": h.direction,
                            }
                            for h in hits
                        ],
                        "count": len(hits),
                    },
                    ensure_ascii=False,
                )
            )
        elif not hits:
            print("no relations (unknown note, or it has no [[wikilinks]])")
        else:
            for h in hits:
                arrow = "->" if h.direction == "out" else "<-"
                dst = h.target_path or f"{h.target} (unresolved)"
                ctx = f"  ({h.context})" if h.context else ""
                if h.direction == "out":
                    print(f"{h.source_path} {arrow} [{h.relation_type}] {dst}{ctx}")
                else:
                    print(f"{h.source_path} {arrow} [{h.relation_type}] (this note){ctx}")
    elif args.cmd in ("observations", "json-observations"):
        if not args.no_auto_index:
            ensure_fresh(args.vault)
        hits = observations_query(
            args.vault,
            category=args.category,
            tag=args.tag,
            note=args.note,
            limit=args.limit,
        )
        if args.cmd == "json-observations":
            print(
                json.dumps(
                    {
                        "filters": {
                            "category": args.category,
                            "tag": args.tag,
                            "note": args.note,
                        },
                        "observations": [
                            {
                                "source_path": h.source_path,
                                "category": h.category,
                                "content": h.content,
                                "tags": h.tags,
                            }
                            for h in hits
                        ],
                        "count": len(hits),
                    },
                    ensure_ascii=False,
                )
            )
        elif not hits:
            print("no observations match (try a different category/tag, or index first)")
        else:
            for h in hits:
                print(f"{h.source_path}\t[{h.category}] {h.content}")
    elif args.cmd in ("kg-suggest", "json-kg-suggest"):
        if not args.no_auto_index:
            ensure_fresh(args.vault)
        result = suggest_structure(args.vault, args.note)
        if args.cmd == "json-kg-suggest":
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(f"note: {result['note']}")
            print(
                f"  relations: {len(result['relations'])}  "
                f"observations: {len(result['observations'])}"
            )
            if result.get("untyped_links"):
                print("  untyped links you could type (- <verb> [[target]]):")
                for t in result["untyped_links"]:
                    print(f"    [[{t}]]")
            if result.get("observation_candidates"):
                print("  prose bullets you could turn into - [category] observations:")
                for c in result["observation_candidates"]:
                    print(f"    {c}")
    elif args.cmd in ("memory-report", "json-memory-report"):
        if not args.no_auto_index:
            ensure_fresh(args.vault, semantic=args.duplicates)
        report = build_report(
            args.vault,
            budget_tokens=args.budget,
            stale_days=args.stale_days,
            similarity=args.similarity,
            duplicates=args.duplicates,
        )
        if args.cmd == "json-memory-report":
            print(json.dumps(report, ensure_ascii=False))
        else:
            t = report["totals"]
            print(
                f"memory report: notes={t['notes']} tokens~={t['tokens']} "
                f"relations={t['relations']} observations={t['observations']}"
            )
            cats = report["indices"]["observations_by_category"]
            if cats:
                top = ", ".join(f"{c['category']}={c['count']}" for c in cats[:6])
                print(f"  observations by category: {top}")
            hubs = report["indices"]["hub_notes"]
            if hubs:
                print("  hub notes (most connected):")
                for h in hubs[:5]:
                    print(f"    {h['path']}\tdegree={h['degree']} (out {h['out']}, in {h['in']})")
            print("  suggested actions:")
            for s in report["suggested_actions"]:
                print(f"    - {s}")


if __name__ == "__main__":
    main()

"""CLI stub for hybrid retrieval (v2)."""

from __future__ import annotations

import argparse


def main() -> None:
    p = argparse.ArgumentParser(prog="obsidian-memory-rag")
    sub = p.add_subparsers(dest="cmd", required=True)
    ix = sub.add_parser("index", help="Index vault (stub)")
    ix.add_argument("--vault", required=True)
    q = sub.add_parser("search", help="Search (stub)")
    q.add_argument("query")
    args = p.parse_args()
    if args.cmd == "index":
        print("index: not implemented in this beta (see ADR-0014)")
    elif args.cmd == "search":
        print("search:", args.query, "(stub)")


if __name__ == "__main__":
    main()

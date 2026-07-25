#!/usr/bin/env python3
"""Cross-project leakage probe (ADR-0074).

For a query whose ground truth is `PROJECTS/X`, how often does a DIFFERENT
`PROJECTS/Y` appear in the top-k, at what rank, and with which `why` label?

Reports two numbers deliberately, because only one of them means anything:

- **top-k leak rate** — inflated by construction on a small vault. The semantic pass is
  dense (every note is a candidate), so on a 19-note corpus a k=10 result is half the
  vault and "another project appeared" is close to guaranteed. Reported, not trusted.
- **top-3 leak count** — the number an agent actually pays for, since the doctrine tells
  it to read the returned section and stop.

`--embedder` is the whole point: the deterministic hashing embedder is a dependency-free
fallback with poor semantic discrimination, so a leak seen only there is a property of
the fallback and not of a `--full` install, which ships fastembed. Running both is the
experiment; running one is an anecdote.

    python evals/cross-project/probe.py --corpus evals/retrieval/corpus \
        --queries evals/retrieval/queries.jsonl --embedder hashing
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "packages" / "obsidian-memory-rag" / "src"))

from obsidian_memory_rag.embeddings import get_embedder  # noqa: E402
from obsidian_memory_rag.indexer import index_vault, index_vectors  # noqa: E402
from obsidian_memory_rag.query import _why, hybrid_search  # noqa: E402

PROJECT_PREFIX = "PROJECTS/"


def load_queries(path: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def probe(corpus: Path, queries: Path, embedder_name: str | None, ks=(3, 5, 10)) -> dict:
    emb = get_embedder(embedder_name)
    index_vault(corpus)
    index_vectors(corpus, emb)
    rows = [
        (d, {r for r in d["relevant"] if r.startswith(PROJECT_PREFIX)})
        for d in load_queries(queries)
    ]
    rows = [(d, own) for d, own in rows if own]
    out = {"embedder": emb.name, "queries": len(rows), "by_k": {}, "why": {}, "top3": []}
    for k in ks:
        leaked = foreign_total = 0
        for d, own in rows:
            foreign = [
                (i + 1, h)
                for i, h in enumerate(hybrid_search(corpus, d["query"], emb, limit=k))
                if h.path.startswith(PROJECT_PREFIX) and h.path not in own
            ]
            if foreign:
                leaked += 1
                foreign_total += len(foreign)
            if k == 3:
                for rank, h in foreign:
                    label = _why(h)
                    out["why"][label] = out["why"].get(label, 0) + 1
                    out["top3"].append(
                        {"query": d["query"][:60], "rank": rank, "path": h.path, "why": label}
                    )
        out["by_k"][k] = {"leaking_queries": leaked, "foreign_hits": foreign_total}
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", type=Path, required=True)
    ap.add_argument("--queries", type=Path, required=True)
    ap.add_argument("--embedder", default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    r = probe(args.corpus, args.queries, args.embedder)
    if args.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return
    print(f"cross-project leakage · embedder={r['embedder']} · n={r['queries']} project queries")
    for k, v in r["by_k"].items():
        pct = 100 * v["leaking_queries"] / r["queries"] if r["queries"] else 0
        note = "  (inflated on a small vault — see the module docstring)" if k >= 10 else ""
        print(
            f"  k={k:<3} leaking {v['leaking_queries']}/{r['queries']} = {pct:3.0f}%"
            f"   foreign hits={v['foreign_hits']}{note}"
        )
    print(f"  top-3 foreign hits by `why` label: {r['why'] or '{}'}")
    for t in r["top3"]:
        print(f"    rank {t['rank']} {t['why']:8} {t['path']:28} <- {t['query']}")
    # No assertion, no exit code: this probe answers a question, it does not defend a
    # floor. A gate here would freeze a number measured on one embedder.


if __name__ == "__main__":
    main()

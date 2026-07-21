---
status: draft-local
generated: 2026-07-20T16:00:00Z
model: phi4-mini
sources: [a1b2c3d4-sqlite-vec-benchmark.md, e5f6a7b8-cpu-rerankers.md, c9d0e1f2-vec-caveat.md]
---

## a1b2c3d4-sqlite-vec-benchmark.md

url: https://example-bench.dev/sqlite-vec-1m
title: sqlite-vec at 1M vectors

The benchmark compared sqlite-vec to a naive scan. sqlite-vec was much faster at one
million vectors, answering in 41ms versus 2900ms. At ten thousand vectors they were similar.

---

## e5f6a7b8-cpu-rerankers.md

url: https://example-mlblog.io/cpu-cross-encoders

The article says rerankers work on CPU. A MiniLM cross-encoder reranks 50 passages in
about 100ms on a laptop.

---

## c9d0e1f2-vec-caveat.md

The update says the crossover moved from 50k to 200k vectors because scan kernels improved.

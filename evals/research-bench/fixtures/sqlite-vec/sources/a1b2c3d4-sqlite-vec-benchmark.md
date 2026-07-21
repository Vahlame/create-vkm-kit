---
url: https://example-bench.dev/sqlite-vec-1m
title: sqlite-vec at 1M vectors
retrieved: 2026-07-18T10:12:00Z
query: sqlite-vec performance
extraction: heuristic
relevant: true
origin: web
status: raw
---

We benchmarked sqlite-vec against a naive full-scan cosine in Python. At 1M vectors,
sqlite-vec answered top-10 queries in 41ms vs 2,900ms for the scan. At 10k vectors the
difference was 3ms vs 5ms — within noise. Memory overhead of the index was 1.4x raw.

---
type: topic
created: 2026-01-14
tags: [stack, python, search]
---

# python-rag

Motor de busqueda del kit, en Python stdlib-only. Verdict: unknown.

## Notas tecnicas

- Indice incremental SQLite FTS5 con ranking BM25.
- Embeddings por feature-hashing (cero dependencias) o fastembed opcional.
- Fusion de rankings lexico + semantico via Reciprocal Rank Fusion (RRF).
- Devuelve el chunk relevante (passage-first), no la nota completa.

## Veces visto

- memory-kit.

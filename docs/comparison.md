# Comparison

Honest positioning for the **v3 kit** (cross-platform, `basic-memory`, optional Go daemon + hybrid semantic RAG). Opinionated one-liners; follow links for nuance.

| Feature                         | v3 kit (this repo)                                                        | Cursor built-in memory | mem0                     | Letta / MemGPT             | Custom RAG (pgvector / Qdrant) |
| ------------------------------- | ------------------------------------------------------------------------- | ---------------------- | ------------------------ | -------------------------- | ------------------------------ |
| Storage ownership               | Markdown in **your** git repo                                             | Cursor cloud           | SaaS or self-host        | Self-host server           | Your DB                        |
| IDE lock-in                     | Low (`AGENTS.md` + MCP)                                                   | High                   | Low                      | Medium                     | Low                            |
| Transport                       | MCP Streamable HTTP (`basic-memory`)                                      | proprietary            | HTTP SDK                 | HTTP / WS                  | SQL / gRPC                     |
| Offline-friendly                | Local vault reads yes                                                     | varies                 | usually no               | if self-host               | if self-host                   |
| Sync story                      | git (+ optional Syncthing)                                                | account sync           | service                  | server backup              | replication                    |
| Retrieval latency at huge scale | optional **hybrid** sidecar: FTS5 BM25 + semantic vectors (ADR-0014/0017) | opaque                 | service tuned            | strong                     | strongest                      |
| Setup time                      | minutes (`uvx` + config)                                                  | zero                   | account + SDK            | server                     | schema + indexer               |
| Compliance hooks                | docs + optional age + OTel redaction                                      | opaque                 | vendor docs              | your policy                | your policy                    |
| Best at                         | Human-editable durable notes for agents                                   | quick ephemeral prefs  | app-embedded user memory | agent runtime memory tiers | huge corpora                   |
| Worst at                        | Not a billion-row warehouse                                               | portability / audit    | markdown-first editing   | ops complexity             | free-form note UX              |

## When to pick this kit

You want **plain Markdown**, **git history**, **multi-IDE** access, and an incremental path to **hybrid retrieval** without running a cluster on day one.

## When not to

You need **multi-tenant SaaS memory** at API scale — use mem0 or a service you control. You need **strict sub-50ms** vector search over billions of rows — use a dedicated vector database and offline indexers.

## mem0 coexistence

mem0 is excellent for **application** memory; this pattern is for **developer / IDE** memory. They can coexist.

## Markdown vs SQLite

Markdown diffs are human-auditable; SQLite wins on constraints. We bias Markdown for agent memory; use Postgres/Qdrant for multi-tenant or high-scale product backends you control separately from this vault pattern.

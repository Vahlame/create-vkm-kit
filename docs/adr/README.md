# Architecture Decision Records

Each file in this directory captures one design decision: what was chosen, what alternatives existed, and why the chosen path won. Early ADRs reflect the original Windows-first kit; **ADR-0010 onward** document the current cross-platform stack.

| ID                                                             | Title                                                                                 | Status   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| [ADR-0001](./0001-use-mcp-remote-instead-of-direct-sse.md)     | Use `mcp-remote` instead of pointing Cursor at the SSE server directly                | Accepted |
| [ADR-0002](./0002-run-mcp-server-as-separate-process.md)       | Run the MCP server as a separate process                                              | Accepted |
| [ADR-0003](./0003-scheduled-tasks-via-wscript.md)              | Run scheduled tasks via `wscript.exe` and a VBS shim                                  | Accepted |
| [ADR-0004](./0004-sync-order-add-commit-pull-push.md)          | Sync order: `add -> commit -> pull --rebase -> push`                                  | Accepted |
| [ADR-0005](./0005-powershell-5-compatible-json-merge.md)       | Use PowerShell 5.1-compatible JSON merging                                            | Accepted |
| [ADR-0006](./0006-no-runnable-scripts-in-this-repo.md)         | Scripts live in the user's vault, not in this repo                                    | Accepted |
| [ADR-0007](./0007-windows-first-pattern.md)                    | Windows-first; other platforms via separate prompt variants                           | Accepted |
| [ADR-0008](./0008-vault-doctor-as-canonical-tool.md)           | Ship `Vault-Doctor.ps1` as the canonical vault health audit alongside `Doctor.ps1`    | Accepted |
| [ADR-0009](./0009-frontmatter-and-three-level-reading-flow.md) | Default vault layout with YAML frontmatter and a three-level agent reading flow       | Accepted |
| [ADR-0010](./0010-migrate-to-basic-memory.md)                  | Migrate MCP stack to `basic-memory` (Streamable HTTP)                                 | Accepted |
| [ADR-0011](./0011-adopt-agents-md.md)                          | `AGENTS.md` as canonical agent surface (IDE-agnostic)                                 | Accepted |
| [ADR-0012](./0012-go-daemon-cross-platform.md)                 | Cross-platform Go daemon (`obsidian-memoryd`) replaces PowerShell + Task Scheduler    | Accepted |
| [ADR-0013](./0013-syncthing-as-transport.md)                   | Syncthing as an optional sync transport                                               | Accepted |
| [ADR-0014](./0014-hybrid-retrieval-sqlite-vec.md)              | Hybrid retrieval (FTS5 + sqlite-vec) as optional RAG sidecar                          | Accepted |
| [ADR-0015](./0015-privacy-compliance-documentation.md)         | Generic privacy / telemetry guardrails in docs (no legal advice)                      | Accepted |
| [ADR-0016](./0016-localhost-mcp-default-port.md)               | Default localhost port 8765 for Streamable HTTP `basic-memory` (avoid 8000 clashes)   | Accepted |
| [ADR-0017](./0017-hybrid-query-embeddings.md)                  | Hybrid query: pluggable embeddings + pure-Python cosine (realizes ADR-0014)           | Accepted |
| [ADR-0018](./0018-multi-agent-token-efficiency.md)             | Multi-agent token efficiency: passage-first reads, auto-indexed search, data envelope | Accepted |
| [ADR-0019](./0019-graph-aware-retrieval.md)                    | Graph-aware retrieval over the `[[wikilink]]` graph (+ Trie autocomplete)             | Accepted |
| [ADR-0020](./0020-measured-retrieval-quality.md)               | Measured retrieval quality (recall@k / MRR) as a CI gate                              | Accepted |
| [ADR-0021](./0021-ranking-upgrades-and-graded-metrics.md)      | Graded metrics (nDCG/MAP), harder golden set, weighted RRF, BM25F, opt-in recency     | Accepted |
| [ADR-0022](./0022-codex-first-class-and-full-preset.md)        | Codex CLI as a first-class wiring target + `--full` one-shot preset                   | Accepted |
| [ADR-0023](./0023-structured-knowledge-graph.md)               | Structured knowledge graph: typed relations + categorized observations                | Accepted |
| [ADR-0024](./0024-memory-reports-and-compaction.md)            | Memory reports: automatic indices, hygiene, and compaction candidates                 | Accepted |
| [ADR-0025](./0025-optional-sqlite-vec-acceleration.md)         | Optional sqlite-vec acceleration for semantic search (decline Chroma/LanceDB)         | Accepted |

## Template

When proposing a new decision, copy `template.md` and add a row to the table above.

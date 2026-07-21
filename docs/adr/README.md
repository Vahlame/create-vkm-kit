# Architecture Decision Records

Each file in this directory captures one design decision: what was chosen, what alternatives existed, and why the chosen path won. Early ADRs reflect the original Windows-first kit; **ADR-0010 onward** document the current cross-platform stack.

| ID                                                                 | Title                                                                                     | Status                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [ADR-0001](./0001-use-mcp-remote-instead-of-direct-sse.md)         | Use `mcp-remote` instead of pointing Cursor at the SSE server directly                    | Accepted                                       |
| [ADR-0002](./0002-run-mcp-server-as-separate-process.md)           | Run the MCP server as a separate process                                                  | Accepted                                       |
| [ADR-0003](./0003-scheduled-tasks-via-wscript.md)                  | Run scheduled tasks via `wscript.exe` and a VBS shim                                      | Accepted                                       |
| [ADR-0004](./0004-sync-order-add-commit-pull-push.md)              | Sync order: `add -> commit -> pull --rebase -> push`                                      | Accepted                                       |
| [ADR-0005](./0005-powershell-5-compatible-json-merge.md)           | Use PowerShell 5.1-compatible JSON merging                                                | Accepted                                       |
| [ADR-0006](./0006-no-runnable-scripts-in-this-repo.md)             | Scripts live in the user's vault, not in this repo                                        | Accepted                                       |
| [ADR-0007](./0007-windows-first-pattern.md)                        | Windows-first; other platforms via separate prompt variants                               | Accepted                                       |
| [ADR-0008](./0008-vault-doctor-as-canonical-tool.md)               | Ship `Vault-Doctor.ps1` as the canonical vault health audit alongside `Doctor.ps1`        | Accepted                                       |
| [ADR-0009](./0009-frontmatter-and-three-level-reading-flow.md)     | Default vault layout with YAML frontmatter and a three-level agent reading flow           | Accepted                                       |
| [ADR-0010](./0010-migrate-to-basic-memory.md)                      | Migrate MCP stack to `basic-memory` (Streamable HTTP)                                     | Accepted                                       |
| [ADR-0011](./0011-adopt-agents-md.md)                              | `AGENTS.md` as canonical agent surface (IDE-agnostic)                                     | Accepted                                       |
| [ADR-0012](./0012-go-daemon-cross-platform.md)                     | Cross-platform Go daemon (`obsidian-memoryd`) replaces PowerShell + Task Scheduler        | Accepted                                       |
| [ADR-0013](./0013-syncthing-as-transport.md)                       | Syncthing as an optional sync transport                                                   | Accepted                                       |
| [ADR-0014](./0014-hybrid-retrieval-sqlite-vec.md)                  | Hybrid retrieval (FTS5 + sqlite-vec) as optional RAG sidecar                              | Accepted                                       |
| [ADR-0015](./0015-privacy-compliance-documentation.md)             | Generic privacy / telemetry guardrails in docs (no legal advice)                          | Accepted                                       |
| [ADR-0016](./0016-localhost-mcp-default-port.md)                   | Default localhost port 8765 for Streamable HTTP `basic-memory` (avoid 8000 clashes)       | Accepted                                       |
| [ADR-0017](./0017-hybrid-query-embeddings.md)                      | Hybrid query: pluggable embeddings + pure-Python cosine (realizes ADR-0014)               | Accepted                                       |
| [ADR-0018](./0018-multi-agent-token-efficiency.md)                 | Multi-agent token efficiency: passage-first reads, auto-indexed search, data envelope     | Accepted                                       |
| [ADR-0019](./0019-graph-aware-retrieval.md)                        | Graph-aware retrieval over the `[[wikilink]]` graph (+ Trie autocomplete)                 | Accepted                                       |
| [ADR-0020](./0020-measured-retrieval-quality.md)                   | Measured retrieval quality (recall@k / MRR) as a CI gate                                  | Accepted                                       |
| [ADR-0021](./0021-ranking-upgrades-and-graded-metrics.md)          | Graded metrics (nDCG/MAP), harder golden set, weighted RRF, BM25F, opt-in recency         | Accepted                                       |
| [ADR-0022](./0022-codex-first-class-and-full-preset.md)            | Codex CLI as a first-class wiring target + `--full` one-shot preset                       | Accepted                                       |
| [ADR-0023](./0023-structured-knowledge-graph.md)                   | Structured knowledge graph: typed relations + categorized observations                    | Accepted                                       |
| [ADR-0024](./0024-memory-reports-and-compaction.md)                | Memory reports: automatic indices, hygiene, and compaction candidates                     | Accepted                                       |
| [ADR-0025](./0025-optional-sqlite-vec-acceleration.md)             | Optional sqlite-vec acceleration for semantic search (decline Chroma/LanceDB)             | Accepted                                       |
| [ADR-0026](./0026-cross-encoder-reranker.md)                       | Optional cross-encoder reranker (final precision pass, `[rerank]` extra, off by default)  | Accepted                                       |
| [ADR-0027](./0027-type-weighted-graph-and-importance.md)           | Type-weighted graph recall + importance (in-degree) bias                                  | Accepted                                       |
| [ADR-0028](./0028-mmr-and-passage-window.md)                       | MMR diversification + passage-window expansion (decline convex fusion for now)            | Accepted                                       |
| [ADR-0029](./0029-disable-claude-native-auto-memory.md)            | Disable Claude Code's native auto-memory + install a SessionStart vault hook              | Accepted                                       |
| [ADR-0030](./0030-deterministic-enforcement-hooks.md)              | Deterministic enforcement hooks: PreToolUse native-memory guard + Stop close-ritual nudge | Accepted                                       |
| [ADR-0031](./0031-effort-gate-hook.md)                             | Effort-gate hook: PreToolUse pause-and-confirm before costly work                         | Accepted                                       |
| [ADR-0032](./0032-token-discipline-and-token-economy-benchmark.md) | Token discipline distilled from caveman/ponytail + measured token-economy benchmark       | Accepted                                       |
| [ADR-0033](./0033-self-paste-frontmatter-guard.md)                 | Guard `vault_edit_file` against self-paste frontmatter duplication                        | Accepted                                       |
| [ADR-0034](./0034-compact-wire-format-and-lower-default-limit.md)  | Compact search wire format (`explain` opt-in) + default limit 20→10, wire-measured        | Accepted                                       |
| [ADR-0035](./0035-fixed-cost-diet-schema-budget.md)                | Fixed-cost diet: tool-schema budget gate, KG defaults 200→50, compressed session hook     | Accepted                                       |
| [ADR-0036](./0036-rules-block-diet-and-drift-gate.md)              | Rules-block diet (−18%, zero rules lost, two rescued) + sync turned into a build gate     | Accepted                                       |
| [ADR-0037](./0037-vault-vs-database-system-of-record.md)           | Vault = memory layer, not system of record: transactions/concurrency/auth/audit honestly  | Accepted                                       |
| [ADR-0038](./0038-evolutive-memory-loop.md)                        | Evolutive memory loop: learn from failures, reinforce what helps, decay what doesn't      | Accepted                                       |
| [ADR-0039](./0039-rules-contract.md)                               | RULES contract: dated, sourced, reasoned project rules                                    | Accepted                                       |
| [ADR-0040](./0040-reliability-isolation-hardening.md)              | Reliability + isolation hardening: cross-process lock, MCP wire lockdown, decay scoring   | Accepted                                       |
| [ADR-0041](./0041-vkm-kit-rename-and-back-compat.md)               | vkm-kit rename: brand now, machine identifiers dual-read, wire contracts frozen           | Accepted                                       |
| [ADR-0042](./0042-version-locked-suite-packages.md)                | Version-lock every suite package to the kit version (reverses the compiler precedent)     | Accepted                                       |
| [ADR-0043](./0043-token-saver-posttooluse-compaction.md)           | Token-saver: conservative PostToolUse output compaction with a hard must-keep guarantee   | Accepted                                       |
| [ADR-0044](./0044-doctor-telemetry-local-otlp-sink.md)             | Doctor telemetry via a standalone local OTLP/HTTP JSON sink (port 4319, NDJSON, 90d)      | Accepted                                       |
| [ADR-0045](./0045-assemble-context-single-call.md)                 | `assemble_context`: single-call budgeted context assembly (median 68% wire savings)       | Accepted                                       |
| [ADR-0046](./0046-absorb-prompt-compiler-into-vkm-spec.md)         | Absorb `obsidian-prompt-compiler` into vkm-spec and delete the package                    | Accepted                                       |
| [ADR-0047](./0047-ollama-structured-outputs.md)                    | Local LLM drafting via Ollama structured outputs; deterministic fallback as invariant     | Accepted                                       |
| [ADR-0048](./0048-spec-gui-sse-and-ports.md)                       | vkm-spec GUI transport (SSE) + suite port allocation (4923 app / 4319 sink)               | Accepted                                       |
| [ADR-0049](./0049-discipline-doctrine-three-channels.md)           | Discipline doctrine in three channels: output style, managed-block bullet, skill          | Accepted                                       |
| [ADR-0050](./0050-release-train-and-npm-shim.md)                   | 4.0.0 release train: two additive minors, breaking changes last, npm shim forever         | Amended (2026-07-20: shim retired unpublished) |
| [ADR-0051](./0051-obscura-web-stealth-browser.md)                  | obscura-web: stealth web fetch + robust layered search via a local headless browser       | Accepted                                       |
| [ADR-0052](./0052-searxng-on-demand-lifecycle.md)                  | SearXNG search backend: on-demand lifecycle (MCP-owned) + desktop monitor                 | Accepted                                       |
| [ADR-0053](./0053-vkm-design-skill.md)                             | `vkm-design`: model-agnostic professional design skill (direction, validators, modes)     | Accepted                                       |
| [ADR-0054](./0054-obscura-research-local-deep-crawl.md)            | `obscura_research`: deep web research as local CPU/RAM work, not tokens                   | Accepted                                       |
| [ADR-0055](./0055-obscura-research-local-llm-curation.md)          | `obscura_research` curates pages with a local Ollama model, not keyword overlap           | Accepted                                       |
| [ADR-0056](./0056-research-knowledge-bank.md)                      | `RESEARCH/`: persistent web-research knowledge bank in the same vault, section-filtered   | Accepted                                       |
| [ADR-0057](./0057-obscura-research-gather-over-rank.md)            | `obscura_research`: the answer is lost at gather, not at rank                             | Accepted                                       |
| [ADR-0058](./0058-vkm-downloads-file-download-tool.md)             | vkm-downloads: a guarded file-download manager MCP                                        | Accepted                                       |
| [ADR-0059](./0059-vkm-downloads-background-jobs-and-mirrors.md)    | vkm-downloads: background jobs, sets, resume, and fastest-mirror selection                | Accepted                                       |
| [ADR-0060](./0060-obscura-deep-research-background-job.md)         | Background deep-research jobs: depth that outlives an agent-loop turn                     | Accepted                                       |
| [ADR-0061](./0061-kit-update-and-skill-structure-gate.md)          | Kit update path (three-way hash classification) + skill-structure gate                    | Accepted                                       |

## Template

When proposing a new decision, copy `template.md` and add a row to the table above.

# Architecture Decision Records

Each file in this directory captures one design decision: what was chosen, what alternatives existed, and why the chosen path won. Older ADRs reference the archived v1 prompt (`docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md`); v2 decisions are ADR-0010 onward.

| ID                                                             | Title                                                                              | Status   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| [ADR-0001](./0001-use-mcp-remote-instead-of-direct-sse.md)     | Use `mcp-remote` instead of pointing Cursor at the SSE server directly             | Accepted |
| [ADR-0002](./0002-run-mcp-server-as-separate-process.md)       | Run the MCP server as a separate process                                           | Accepted |
| [ADR-0003](./0003-scheduled-tasks-via-wscript.md)              | Run scheduled tasks via `wscript.exe` and a VBS shim                               | Accepted |
| [ADR-0004](./0004-sync-order-add-commit-pull-push.md)          | Sync order: `add -> commit -> pull --rebase -> push`                               | Accepted |
| [ADR-0005](./0005-powershell-5-compatible-json-merge.md)       | Use PowerShell 5.1-compatible JSON merging                                         | Accepted |
| [ADR-0006](./0006-no-runnable-scripts-in-this-repo.md)         | Scripts live in the user's vault, not in this repo                                 | Accepted |
| [ADR-0007](./0007-windows-first-pattern.md)                    | Windows-first; other platforms via separate prompt variants                        | Accepted |
| [ADR-0008](./0008-vault-doctor-as-canonical-tool.md)           | Ship `Vault-Doctor.ps1` as the canonical vault health audit alongside `Doctor.ps1` | Accepted |
| [ADR-0009](./0009-frontmatter-and-three-level-reading-flow.md) | Default vault layout with YAML frontmatter and a three-level agent reading flow    | Accepted |
| [ADR-0010](./0010-migrate-to-basic-memory.md)                  | Migrate MCP stack to `basic-memory` (Streamable HTTP)                              | Accepted |
| [ADR-0011](./0011-adopt-agents-md.md)                          | `AGENTS.md` as canonical agent surface (IDE-agnostic)                              | Accepted |
| [ADR-0012](./0012-go-daemon-cross-platform.md)                 | Cross-platform Go daemon (`obsidian-memoryd`) replaces PowerShell + Task Scheduler | Accepted |
| [ADR-0013](./0013-syncthing-as-transport.md)                   | Syncthing as an optional sync transport                                            | Accepted |
| [ADR-0014](./0014-hybrid-retrieval-sqlite-vec.md)              | Hybrid retrieval (FTS5 + sqlite-vec) as optional RAG sidecar                       | Accepted |
| [ADR-0015](./0015-privacy-compliance-documentation.md)         | Generic privacy / telemetry guardrails in docs (no legal advice)                   | Accepted |

## Template

When proposing a new decision, copy `template.md` and add a row to the table above.

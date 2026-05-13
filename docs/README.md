# Docs

Documentation for the **v2** agent memory pattern (`AGENTS.md`, MCP configs, optional Go daemon, optional RAG).

| File                                                                                                                                                                | Purpose                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`adr/`](./adr/)                                                                                                                                                    | Architecture Decision Records (current stack: ADR-0010 onward).               |
| [`troubleshooting.md`](./troubleshooting.md)                                                                                                                        | Known errors and fixes (MCP, Windows tasks, ports).                           |
| [`faq.md`](./faq.md)                                                                                                                                                | Frequently asked questions about the pattern.                                 |
| [`glossary.md`](./glossary.md)                                                                                                                                      | Definitions: MCP, vault, stdio vs HTTP, hybrid MCP, etc.                      |
| [`comparison.md`](./comparison.md)                                                                                                                                  | Positioning vs Cursor built-in memory, mem0, Letta, and alternatives.         |
| [`observability.md`](./observability.md)                                                                                                                            | Telemetry redaction and optional Langfuse / OTel notes.                       |
| [`setup/windows-sin-consola-visible.md`](./setup/windows-sin-consola-visible.md) / [`.en.md`](./setup/windows-sin-consola-visible.en.md)                            | Windows: workspace Git, tasks, MCP, console flashes.                          |
| [`setup/windows-juego-vault-sync.md`](./setup/windows-juego-vault-sync.md) / [`.en.md`](./setup/windows-juego-vault-sync.en.md)                                     | Windows: vault sync vs gaming (latency, focus).                               |
| [`setup/windows-basic-memory-always-on.md`](./setup/windows-basic-memory-always-on.md)                                                                              | MCP `basic-memory` HTTP + Task Scheduler (see `.en.md`).                      |
| [`setup/windows-scheduled-vault-sync.md`](./setup/windows-scheduled-vault-sync.md)                                                                                  | Git sync task without console flash (see `.en.md`).                           |
| [`setup/memory-repo-sin-automatismos-locales.md`](./setup/memory-repo-sin-automatismos-locales.md) / [`.en.md`](./setup/memory-repo-sin-automatismos-locales.en.md) | Agent memory colocated in one git clone — no local scripts or Task Scheduler. |

Human onboarding starts at [`README.md`](../README.md). Maintainer-only archived trees live under [`legacy/README.md`](./legacy/README.md).

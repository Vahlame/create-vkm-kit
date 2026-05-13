# Migration v2 → v3: public kit without executable scripts (advanced integration)

Everything in this chapter lives on **`main`**: there is no separate “v3” branch.

## What “v3” means

**v3** names the **kit’s shipping model** from this baseline:

- The repository **no longer ships** **PowerShell** templates or **`.vbs`** files under `scripts/windows/`, nor convenience **`tools/*.ps1`** scripts for end-user Windows integration.
- The **advanced** integration the guide already aimed for (stable MCP, vault git, optional FTS, optional HTTP) is achieved with **`uvx`**, the **Go** daemon `obsidian-memoryd`, **JSON templates** (`config/mcp/*.json`), the **npm** initializer, and **documented procedures** — without tying the story to copy-paste `.ps1` files from this repo.

**v3 does not change the memory protocol** (Markdown + MCP + git in your vault). It changes **which artifacts** the public kit promises and ships.

## How this relates to other chapters

| Chapter                                                 | Where                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| v1 → v2 (ultra-prompt → `basic-memory`, public kit)     | [`v1-prompt-closure.md`](./v1-prompt-closure.md), [`v1-to-v2-mcp.md`](./v1-to-v2-mcp.md) |
| **v2 → v3 (no kit scripts, same advanced integration)** | **this document**                                                                        |

## Replacement table (if you depended on repo files)

| Before (v2, files in the kit)                            | v3 (documented equivalent)                                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/windows/Start-BasicMemoryMcp.ps1`               | `uvx basic-memory mcp --transport streamable-http …` in a **terminal** or a **task you define**; [`../setup/windows-basic-memory-always-on.en.md`](../setup/windows-basic-memory-always-on.en.md) |
| `scripts/windows/Run-Hidden.vbs` + `.ps1`                | Not shipped by the kit: minimize the terminal, build `obsidian-memoryd` with `-ldflags="-H windowsgui"`, or provide **your** launcher                                                             |
| `scripts/windows/Get-CursorScheduledTaskConsoleRisk.ps1` | **Task Scheduler** (GUI) + **Task Manager** / **Resource Monitor**                                                                                                                                |
| `tools/monitor-console-live.ps1`                         | Same **manual** approach (process list + command line)                                                                                                                                            |
| `tools/windows-reset-agent-memory.ps1`                   | Manual steps in [`../troubleshooting.md`](../troubleshooting.md) (back up `mcp.json`, remove `Cursor*` tasks, re-run initializer)                                                                 |
| `tools/purge-memory-mcp-cache.ps1`                       | Manually clear caches under `.cursor/projects/…` if needed                                                                                                                                        |

## Advanced integration path **without** kit scripts (recommended order)

1. **Vault + git** — `npx @vahlame/create-obsidian-memory@next`, template [`../../examples/`](../../examples/).
2. **Default MCP** — **stdio** [`../../config/mcp/basic-memory.json`](../../config/mcp/basic-memory.json) + `BASIC_MEMORY_HOME`.
3. **Agent rules** — [`../cursor-memory-setup.en.md`](../cursor-memory-setup.en.md) (User Rules) + [`../../AGENTS.md`](../../AGENTS.md) for repo contributors.
4. **Vault git sync** — [`../../cmd/obsidian-memoryd`](../../cmd/obsidian-memoryd) (`watch`) or **manual git**; [`../setup/windows-scheduled-vault-sync.en.md`](../setup/windows-scheduled-vault-sync.en.md).
5. **Large vaults** — `obsidian-memory-rag` + hybrid MCP [`../../config/mcp/obsidian-memory-hybrid.json`](../../config/mcp/obsidian-memory-hybrid.json); [`../testing/manual-checks.md`](../testing/manual-checks.md) §6–7.
6. **Optional persistent HTTP** — same always-on guide: **no** `.ps1` from this repository is required.
7. **Repo CI / quality** — unchanged for maintainers: TypeScript (`scripts/sync-agents.ts`) and, for the **legacy v1 prompt**, [`.github/scripts/extract-and-lint.ps1`](../../.github/scripts/extract-and-lint.ps1) in workflows.

## History and ADRs

- Historical rationale for the VBS shim (ADR-0003) remains at [`../adr/0003-scheduled-tasks-via-wscript.md`](../adr/0003-scheduled-tasks-via-wscript.md); the header notes the **public guide** no longer ships that template.
- Safe git ordering remains [ADR-0004](../adr/0004-sync-order-add-commit-pull-push.md).

## Spanish

[`v2-to-v3-script-free-kit.md`](./v2-to-v3-script-free-kit.md).

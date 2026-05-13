# First-time setup: linear flow (v2)

Read **in order**. Each step links forward. Do not skip unless marked **optional**.

| Step | What you do                                                | Where it is explained                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Understand the idea (no install yet)                       | [`docs/how-memory-works-simple.en.md`](./docs/how-memory-works-simple.en.md)                                                                                                                                                                                                                                                                                                                                                        |
| 1    | Have a vault folder with Markdown (and git)                | Same doc, “The vault”; sample in [`examples/`](./examples/)                                                                                                                                                                                                                                                                                                                                                                         |
| 2    | Install **Node 20+** and **uv**                            | [§ Requirements in `docs/cursor-memory-setup.en.md`](./docs/cursor-memory-setup.en.md#machine-requirements)                                                                                                                                                                                                                                                                                                                         |
| 3    | Connect the IDE to the vault with **MCP** (`basic-memory`) | Template [`config/mcp/basic-memory.json`](./config/mcp/basic-memory.json) and [§ Step 1 in Cursor guide](./docs/cursor-memory-setup.en.md#step-1-configure-mcp-in-cursor)                                                                                                                                                                                                                                                           |
| 4    | (**Cursor only**) Paste **User Rules**                     | [§ Step 3 in Cursor guide](./docs/cursor-memory-setup.en.md#step-3-user-rules-paste-into-cursor)                                                                                                                                                                                                                                                                                                                                    |
| 5    | Verify MCP tools respond                                   | [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md) §2                                                                                                                                                                                                                                                                                                                                                               |
| 6    | (**Optional**) FTS index + hybrid MCP for large vaults     | [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md) §6–7 and [`config/mcp/obsidian-memory-hybrid.json`](./config/mcp/obsidian-memory-hybrid.json)                                                                                                                                                                                                                                                                    |
| 7    | (**Optional**) Git sync (on save or on a timer)            | Go daemon [`cmd/obsidian-memoryd/`](./cmd/obsidian-memoryd/), Windows task: [`docs/setup/windows-scheduled-vault-sync.en.md`](./docs/setup/windows-scheduled-vault-sync.en.md), **MCP always on:** [`docs/setup/windows-basic-memory-always-on.en.md`](./docs/setup/windows-basic-memory-always-on.en.md). After setup on Windows: [`docs/testing/windows-memory-sync-smoke.en.md`](./docs/testing/windows-memory-sync-smoke.en.md) |

Open the vault as a **workspace folder** so Cursor/VS Code load **`/.vscode/settings.json`** (less Git polling on Windows). The `create-obsidian-memory` command below **creates** that file in the vault if it is missing; template at [`examples/.vscode/settings.json`](./examples/.vscode/settings.json). If the file already existed from an older run, **merge** the new keys or delete it and re-run the initializer. Details: [`docs/troubleshooting.md`](./docs/troubleshooting.md) and [`docs/setup/windows-sin-consola-visible.en.md`](./docs/setup/windows-sin-consola-visible.en.md).

## Shortcut if you already have a vault and a clone

```bash
npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "/absolute/path/to/vault"
```

This **merges** `basic-memory` into Cursor `mcp.json` (Windows: `%USERPROFILE%\.cursor\mcp.json`), and **creates** `vault/.vscode/settings.json` if it was missing (quieter Git on Windows). Then do **step 4** (User Rules) and **step 5** (verification).

## If you hack on this repository (code / PRs)

1. [`AGENTS.md`](./AGENTS.md)
2. [`CONTRIBUTING.md`](./CONTRIBUTING.md)

## Español

Mismo flujo: [`GETTING_STARTED.md`](./GETTING_STARTED.md).

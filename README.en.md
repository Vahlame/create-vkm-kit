# Agent memory with Markdown + MCP (v2 kit)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/release-v2.0.0--dev-orange.svg)](./CHANGELOG.md)
[![CI](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml/badge.svg)](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml)
[![Eval adherence](https://img.shields.io/badge/eval-adherence-1.0-brightgreen.svg)](./evals/README.md)

> Languages: [Español](./README.md) | **English**

## Your path (recommended order)

1. **[`GETTING_STARTED.en.md`](./GETTING_STARTED.en.md)** — step table (linear flow).
2. **[`docs/how-memory-works-simple.en.md`](./docs/how-memory-works-simple.en.md)** — vault, MCP, and User Rules in plain language.
3. **Cursor:** [`docs/cursor-memory-setup.en.md`](./docs/cursor-memory-setup.en.md) (MCP + ready-to-paste User Rules; stdio vs URL and `memory://`).
4. **Verify tools:** [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md) **; Windows (tasks + git + HTTP MCP port, e.g. 8765):** [`docs/testing/windows-memory-sync-smoke.en.md`](./docs/testing/windows-memory-sync-smoke.en.md).
5. **Something breaks:** [`docs/troubleshooting.md`](./docs/troubleshooting.md) (includes flashing console windows and [`tools/monitor-console-live.ps1`](./tools/monitor-console-live.ps1) for diagnosis).
6. **Keep `basic-memory` always on (Windows, HTTP):** [`docs/setup/windows-basic-memory-always-on.en.md`](./docs/setup/windows-basic-memory-always-on.en.md).
7. **Vault git autosync (Windows, no console flash):** [`docs/setup/windows-scheduled-vault-sync.en.md`](./docs/setup/windows-scheduled-vault-sync.en.md).

## What this repository is (one paragraph)

A **cross-platform** kit so AI can read and write **your** Markdown notes via **MCP** (`basic-memory` by default), with optional local **FTS5** indexing, an IDE **hybrid MCP**, and a **Go** daemon for git. Design rationale lives in [`docs/adr/`](./docs/adr/).

## Minimal MCP snippet (quick reference)

```json
{
  "mcpServers": {
    "basic-memory": {
      "command": "uvx",
      "args": ["basic-memory", "mcp"],
      "env": { "BASIC_MEMORY_HOME": "/absolute/path/to/vault" }
    }
  }
}
```

Templates: [`config/mcp/`](./config/mcp/).

## Comparison, privacy, contributing

- Positioning vs alternatives: [`docs/comparison.md`](./docs/comparison.md).
- Privacy / telemetry: [`docs/observability.md`](./docs/observability.md).
- Contributing and ADRs: [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`docs/adr/`](./docs/adr/).
- Agent instructions for **this** repo: [`AGENTS.md`](./AGENTS.md).
- Documentation index: [`docs/README.md`](./docs/README.md).

## License

MIT (`LICENSE`).

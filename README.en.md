# Agent memory with Markdown + MCP (v2)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/release-v2.0.0--dev-orange.svg)](./CHANGELOG.md)
[![CI](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml/badge.svg)](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml)

> Languages: [Español](./README.md) | **English**

## Your path (recommended order)

1. **[`GETTING_STARTED.en.md`](./GETTING_STARTED.en.md)** — step table (linear flow).
2. **[`docs/how-memory-works-simple.en.md`](./docs/how-memory-works-simple.en.md)** — vault, MCP, and User Rules in plain language.
3. **Cursor only:** [`docs/cursor-memory-setup.en.md`](./docs/cursor-memory-setup.en.md) (MCP + ready-to-paste User Rules).
4. **Verify tools:** [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md).
5. **Something breaks:** [`docs/troubleshooting.md`](./docs/troubleshooting.md).

If you migrate from legacy v1 (Windows): [`docs/migration/v1-prompt-closure.md`](./docs/migration/v1-prompt-closure.md) after step 2.

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

## License

MIT (`LICENSE`).

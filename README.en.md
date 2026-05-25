# Agent memory with Markdown + MCP (v3 kit)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/release-v3.0.0--dev-orange.svg)](./CHANGELOG.md)
[![CI](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml/badge.svg)](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml)

> Languages: [Español](./README.md) | **English**

## Start here — pick a path

| Your situation                                  | Read                                                                                   | Time    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- | ------- |
| **I want the agent to install it for me**       | [`INSTALAR_MEMORIA.en.md`](./INSTALAR_MEMORIA.en.md) — paste into a new Cursor chat    | ~5 min  |
| **I'll do it step by step (manual, linear)**    | [`GETTING_STARTED.en.md`](./GETTING_STARTED.en.md) — every step explained              | ~15 min |
| **I just want to understand before installing** | [`docs/how-memory-works-simple.en.md`](./docs/how-memory-works-simple.en.md) — no code | ~5 min  |

All three paths converge on the same thing: a **Markdown + git vault** that the AI reads and writes through **MCP** (`basic-memory` by default).

<details>
<summary><b>Full reference (optional specializations)</b></summary>

> **v2 → v3 migration (all on `main`):** the kit **no longer ships** Windows scripts under `scripts/windows/` or `tools/*.ps1`; see [`docs/migration/v2-to-v3-script-free-kit.en.md`](./docs/migration/v2-to-v3-script-free-kit.en.md).

1. **Cursor (detail):** [`docs/cursor-memory-setup.en.md`](./docs/cursor-memory-setup.en.md) — MCP + ready-to-paste User Rules; stdio vs URL and `memory://`.
2. **Verify MCP responds:** [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md); Windows extra: [`docs/testing/windows-memory-sync-smoke.en.md`](./docs/testing/windows-memory-sync-smoke.en.md).
3. **Something breaks:** [`docs/troubleshooting.md`](./docs/troubleshooting.md) — flashing consoles; diagnose with **Task Manager**.
4. **Optional HTTP MCP (Windows):** [`docs/setup/windows-basic-memory-always-on.en.md`](./docs/setup/windows-basic-memory-always-on.en.md) — only if stdio is not enough.
5. **Optional vault git sync:** [`docs/setup/windows-scheduled-vault-sync.en.md`](./docs/setup/windows-scheduled-vault-sync.en.md) (`obsidian-memoryd` or manual git).
6. **No extra local automation:** colocate memory in the same git repo you already update — [`docs/setup/memory-repo-sin-automatismos-locales.en.md`](./docs/setup/memory-repo-sin-automatismos-locales.en.md).
7. **Windows no-flash / gaming:** [`docs/setup/windows-sin-consola-visible.en.md`](./docs/setup/windows-sin-consola-visible.en.md) · [`docs/setup/windows-juego-vault-sync.en.md`](./docs/setup/windows-juego-vault-sync.en.md).
8. **Existing vault:** re-run the initializer to **merge** config without losing other keys:
   - `basic-memory` only: `npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "/path"`
   - With FTS hybrid: `node packages/create-obsidian-memory/src/index.js --non-interactive --vault "/path" --with-hybrid --repo-root "/path/to/cursor-obsidian-memory-guide"` (install first: `pip install -e packages/obsidian-memory-rag`).

</details>

## What this repository is (one paragraph)

A **cross-platform** kit so AI can read and write **your** Markdown notes via **MCP** (`basic-memory` by default), with optional local **FTS5** indexing, an IDE **hybrid MCP**, and a **Go** daemon for git. Design rationale lives in [`docs/adr/`](./docs/adr/).

## Minimal MCP snippet (quick reference)

```json
{
  "mcpServers": {
    "basic-memory": {
      "command": "uvx",
      "args": ["--from", "basic-memory==0.21.4", "basic-memory", "mcp"],
      "env": { "BASIC_MEMORY_HOME": "/absolute/path/to/vault" }
    }
  }
}
```

> **Security note:** `--from "basic-memory==0.21.4"` **pins** the version. Without a pin, `uvx` pulls the latest from PyPI on every Cursor start — if the package is taken over (account compromise, squatting), the model runs arbitrary code with your privileges. To upgrade, bump the pin by hand after reviewing the basic-memory changelog.

Templates: [`config/mcp/`](./config/mcp/).

## Comparison, privacy, contributing

- Positioning vs alternatives: [`docs/comparison.md`](./docs/comparison.md).
- Privacy / telemetry: [`docs/observability.md`](./docs/observability.md).
- Contributing and ADRs: [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`docs/adr/`](./docs/adr/).
- Agent instructions for **this** repo: [`AGENTS.md`](./AGENTS.md).
- Documentation index: [`docs/README.md`](./docs/README.md).

## License

MIT (`LICENSE`).

# Agent memory with Markdown + MCP (v2)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/release-v2.0.0--dev-orange.svg)](./CHANGELOG.md)
[![CI](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml/badge.svg)](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml)

> Languages: [Español](./README.md) | **English**

v2 is **cross-platform** (Windows/Linux/macOS) and **IDE-agnostic**. Canonical agent instructions live in `AGENTS.md` (with symlinks for Claude Code / Copilot / Cline where supported). The MCP default is **`basic-memory`** via `uvx`; optional live Obsidian I/O uses `config/mcp/obsidian-live.json`.

## Quick install

1. Install **uv** + **Node 20+**.
2. Merge `config/mcp/basic-memory.json` into your IDE MCP config; replace `<VAULT_PATH>`.
3. Run `uvx basic-memory mcp` and verify tools (see `docs/testing/manual-checks.md`).
4. Optional: build `obsidian-memoryd` (`go build ./cmd/obsidian-memoryd`) for debounced git sync.

Guided flow: `npx @vahlame/create-obsidian-memory@next`.

## Migration from v1

- Archived prompt: `docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md`
- Tool mapping: `docs/migration/v1-to-v2-mcp.md`

## Docs

- `docs/comparison.md` — honest positioning vs alternatives.
- `docs/case-study-mep-cr.md` — education-style deployment sketch + Ley 8968 engineering notes.
- `docs/observability.md` — telemetry posture.

## License

MIT.

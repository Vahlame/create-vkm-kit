# ADR-0010: Migrate MCP stack to `basic-memory` (Streamable HTTP)

- **Status:** Accepted
- **Date:** 2026-05-13
- **Deciders:** maintainer

## Context

v1 relied on `@smith-and-web/obsidian-mcp-server` over SSE on port 3001 and `mcp-remote` as an STDIO bridge. SSE-style transports are deprecated in favor of Streamable HTTP (`2025-11-25` MCP revision). We need a maintained server, simpler local config, and parity tools for read/write/search/context over Markdown vaults.

## Decision

Adopt **`basic-memory`** as the primary MCP server, launched via `uvx basic-memory mcp`, with `BASIC_MEMORY_HOME` pointing at the vault root. Keep optional **live Obsidian** access via a separate Streamable HTTP config (`cyanheads/obsidian-mcp-server`) where users need direct vault I/O outside the basic-memory model. Pin `mcp-remote` to at least `^0.1.16` when a bridge is still required for legacy clients.

## Consequences

- **Positive:** Aligns with current MCP transport guidance; fewer moving parts than Node SSE + bridge for greenfield setups; Python `uvx` is widely available on dev machines.
- **Negative:** Users must install Python/`uv` or use containerized runners; tool names and semantics differ from v1 (documented in `docs/migration/v1-to-v2-mcp.md`).
- **Neutral:** v1 prompt and Windows-only scripts remain as historical artifacts under `docs/legacy/`.

## Alternatives considered

- **Stay on smith-and-web + SSE:** Rejected — transport deprecation and maintenance risk.
- **Only cyanheads Obsidian server:** Rejected as sole default — heavier setup; `basic-memory` gives a smaller core with optional Obsidian add-on.

## References

- `docs/migration/v1-to-v2-mcp.md`
- MCP Streamable HTTP specification (2025-11-25)

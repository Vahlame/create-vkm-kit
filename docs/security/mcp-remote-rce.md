# mcp-remote RCE pin (>= 0.1.16)

## Context

Older `mcp-remote` releases had security issues (including RCE-class bugs in dependency / bridge handling). Upstream fixed these in the **0.1.16** line.

## Decision

Document and enforce **`mcp-remote@^0.1.16` minimum** anywhere we still bridge STDIO ↔ HTTP/SSE (legacy Cursor configs, transitional setups). Prefer native **Streamable HTTP** clients when available.

## What you should do

- In `package.json` / initializer output / docs: never pin below `0.1.16`.
- Run `npm ls mcp-remote` after merges that touch MCP bridges.

## References

- **No public CVE id** is tracked here; this guidance is based on the upstream
  `mcp-remote` changelog / release notes, not a numbered advisory. Check the
  registry changelog (`npm view mcp-remote`) when bumping the pin.
- Kit-wide security model and disclosure process: [`../../SECURITY.md`](../../SECURITY.md).

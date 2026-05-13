# Observability (v2)

- **Pino** JSON logs for the optional MCP sidecar (`packages/obsidian-memory-mcp`).
- **OpenTelemetry** OTLP HTTP exporter (optional deps); propagate W3C `traceparent` via MCP `_meta` when your host supports it.
- **Langfuse** (optional): use `compose.observability.yml` for a self-hosted stack; set `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` in your environment.

Never log raw tokens or unnecessary personal identifiers in trace attributes; prefer opaque IDs (`docs/observability.md`).

# Observability

The kit has two observability surfaces. Both are local.

## 1. Daemon health: `obsidian-memoryd doctor`

If you run the Go daemon (`obsidian-memoryd watch`), call `obsidian-memoryd doctor` to see whether it is alive and pushing:

```text
obsidian-memoryd doctor
  state file:               ~/.local/state/obsidian-memory/state.json
  heartbeat:                28s ago
  last successful push:     3m12s ago
  unpushed commits (vault): 0
```

The daemon writes a heartbeat every 60 s and records the timestamp of every successful `git push`, the latest rebase abort, and the count of consecutive push failures. `doctor` exits **non-zero** if the heartbeat is older than 5 min or push has failed 3+ times in a row — wire it into a cron / shell alias so a silent failure on Windows (the daemon runs with `-H windowsgui`, no console) does not go unnoticed.

## 2. Optional MCP-level traces (sidecar)

`packages/obsidian-memory-mcp` emits Pino JSON logs. If you want structured traces:

- **OpenTelemetry OTLP** exporter is an optional dependency (`@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`). Install with `npm install --include=optional` inside the workspace; set `OTEL_EXPORTER_OTLP_ENDPOINT` to your collector.
- The sidecar propagates W3C `traceparent` via MCP `_meta` when the host supports it.

**Do not log raw tokens or PII** in trace attributes; prefer opaque IDs. Spans should carry only operation names and durations.

## Performance / retrieval benchmark

The hybrid-retrieval target (ADR-0014) is **P95 < 150 ms over ~10k chunks**. Measure your own
vault with the bench CLI and record hardware, embedder, and vault size next to the number:

```bash
obsidian-memory-rag bench --vault "<VAULT>" --iterations 200 --query "memory"
```

Brute-force cosine is sub-10 ms for a personal vault; `sqlite-vec` acceleration is documented as
future work (ADR-0014 / ADR-0017).

## What this repo deliberately does not ship

A docker-compose stack for Langfuse / ClickHouse / Redis used to live at `compose.observability.yml`. It was removed in v3 because the daemon and sidecar never wired metrics or traces to it — keeping the file alongside docs implied an instrumentation story that did not exist. If you want a full LLM observability backend, run Langfuse separately and point the sidecar's OTLP exporter at it.

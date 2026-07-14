# Observability

The kit has three observability surfaces. All of them are local — nothing leaves your machine.

## 1. Daemon health: `obsidian-memoryd doctor`

If you run the Go daemon (`obsidian-memoryd watch`), call `obsidian-memoryd doctor` to see whether it is alive and pushing:

```text
obsidian-memoryd doctor
  state file:               ~/.local/state/obsidian-memory/state.json
  heartbeat:                28s ago
  last successful push:     3m12s ago
  unpushed commits (vault): 0
```

The daemon writes a heartbeat every 60 s and records the timestamp of every successful `git push`, the latest rebase abort, and the count of consecutive push failures. `doctor` exits **non-zero** if the heartbeat is older than 5 min, push has failed 3+ times in a row, the vault has failed to sync 3+ times in a row, a rebase abort is on record, or the filesystem watcher failed to start — wire it into a cron / shell alias so a silent failure on Windows (the daemon runs with `-H windowsgui`, no console) does not go unnoticed.

> ⚠️ **Windows/PowerShell gotcha:** a `-H windowsgui` build's `doctor` subcommand only gets a reliable `$LASTEXITCODE` and fully-ordered output when its output is redirected (piped) or you wait explicitly — PowerShell does not wait for a GUI-subsystem process otherwise. See `docs/en/troubleshooting.md` / `docs/es/troubleshooting.md` ("doctor's exit code reads empty in PowerShell") for the confirmed cause and the correct invocation pattern before wiring `doctor` into a cron job or alias.

## 2. Token & cache usage: `vkm-doctor` (local OTLP sink, ADR-0044)

When the installer wires Claude Code (and a kit clone is available), it also points Claude Code's OTEL metrics export at a **local** sink: a managed env block plus a `SessionStart` hook (`ensure-otel-sink.mjs`) that spawns `vkm-otel-sink` on **`127.0.0.1:4319`** (localhost-only, lockfile singleton). Metrics land as NDJSON under `~/.vkm/telemetry/` with a 90-day prune. No cloud collector, no accounts — the data never leaves the machine.

Read it with the CLI:

```bash
vkm-doctor                        # last 30 days: tokens, cost, cache-hit ratio + broken-cache diagnosis
vkm-doctor --days 7               # narrower window
vkm-doctor --json                 # machine-readable output
vkm-doctor --include-transcripts  # adds a clearly-labelled transcript-derived section
```

The cache-hit ratio ships with a diagnosis: a consistently low ratio usually means a broken prompt cache (something mutating the system prompt every turn) — the single biggest silent cost multiplier. `--include-transcripts` parses local session transcripts as a **labelled fallback** (Claude Code's JSONL transcript format is internal and unstable — the official docs discourage parsing it); it is reported in its own section, never mixed with the OTEL numbers.

Remove the whole surface with `--no-telemetry` on an installer re-run, or as part of `--uninstall`.

## 3. Optional MCP-level traces (sidecar)

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

The vector/semantic half of hybrid retrieval **is shipped** (ADR-0017): the default
`HashingEmbedder` (pure-stdlib, lexical vectors) runs out of the box, and the optional
`fastembed` extra (`pip install 'obsidian-memory-rag[semantic]'` →
`OBSIDIAN_MEMORY_EMBEDDER=fastembed`) adds true meaning-based recall. Search is a full-scan
cosine in Python, sub-10 ms for a personal vault. `sqlite-vec` is **deferred acceleration** for
very large vaults — not unshipped functionality, just an optimization that slots in behind the
same `vector_store` interface when brute-force cosine stops being fast enough (ADR-0014 / ADR-0017).

## Vault health

`obsidian-memory-rag audit` (and the `vault_audit` MCP tool) surfaces oversized notes (over the
~8k-token budget), broken `[[wikilinks]]` (a stale-memory signal), and `SESSION_LOG.md` size.
`rotate-log` archives old `SESSION_LOG.md` sections to `SESSION_LOG/archive.md`, keeping the most
recent in place (non-destructive). Together they keep retrieval cheap as the vault grows.

| Surface           | Command / tool                              | Signals                                                        |
| ----------------- | ------------------------------------------- | -------------------------------------------------------------- |
| Daemon health     | `obsidian-memoryd doctor`                   | heartbeat age, last successful push, consecutive push failures |
| Token/cache usage | `vkm-doctor` (sink on `127.0.0.1:4319`)     | tokens, cost, cache-hit ratio, broken-cache diagnosis          |
| MCP-level traces  | Pino JSON + OTLP exporter (sidecar)         | operation names, durations, W3C `traceparent` propagation      |
| Vault health      | `obsidian-memory-rag audit` / `vault_audit` | oversized notes, broken `[[wikilinks]]`, `SESSION_LOG.md` size |
| Log rotation      | `obsidian-memory-rag rotate-log`            | archives old `SESSION_LOG.md` sections (non-destructive)       |

## What this repo deliberately does not ship

A docker-compose stack for Langfuse / ClickHouse / Redis used to live at `compose.observability.yml`. It was removed in v3 because the daemon and sidecar never wired metrics or traces to it — keeping the file alongside docs implied an instrumentation story that did not exist. If you want a full LLM observability backend, run Langfuse separately and point the sidecar's OTLP exporter at it.

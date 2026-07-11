# ADR-0044: doctor telemetry via a standalone local OTLP/HTTP JSON sink

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** maintainer

## Context

`vkm-doctor` exists to answer "what are my sessions actually costing, and is prompt caching working?" — which requires real token/cost data, not estimates. Claude Code exports OTLP metrics (`claude_code.token.usage` with `type`/`model` attributes, `claude_code.cost.usage`) when `CLAUDE_CODE_ENABLE_TELEMETRY=1` and an exporter/endpoint are configured, but something must be listening: OTLP is push-based, and the only other data source — the session transcript JSONL — is officially documented as an unstable format not to be parsed. Constraints: no OS service installation, no cloud (data must never leave the machine), no protobuf toolchain, and it must work for installs that skip the optional Go daemon.

## Decision

Ship a **standalone, zero-dependency local OTLP/HTTP JSON sink** in the new `vkm-doctor` package (`vkm-otel-sink`): a `node:http` server bound to **127.0.0.1:4319** accepting the OTLP JSON protocol on `POST /v1/metrics`, appending compact NDJSON rollups to `~/.vkm/telemetry/YYYY-MM-DD.ndjson` (files pruned after 90 days), made a singleton by a pid+port lockfile. Liveness needs no service: the installer wires a **`SessionStart` hook** (`ensure-otel-sink.mjs`) that spawns the sink detached when it isn't running — guaranteed alive whenever Claude Code is. The parser is **tolerant by design**: unknown metric names and shapes are archived raw instead of dropped, malformed payloads are answered 200 and archived, never crashed on (payload drift between Claude Code versions is an accepted risk, degraded to "stored but unaggregated"). The installer manages exactly four env vars (`CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_METRICS_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4319`), reversible via `--no-telemetry`. Transcript scanning survives only as a fallback whose every figure is labeled `source: "transcript-estimate"` — OTEL-sourced and estimated numbers are never silently mixed. Local-only is by construction, not policy: the bind address is loopback and the data directory is the user's home.

## Alternatives considered

- **OTEL console exporter:** rejected — it writes to Claude Code's own stderr, which is unusable as a data store and pollutes the very sessions being measured.
- **Prometheus exporter:** rejected — pull-model metrics are only alive while the session process runs, so a scraper misses everything between scrapes and there is no history; the doctor's whole value is per-day trends.
- **OTLP receiver inside the Go daemon (`obsidian-memoryd`):** rejected — the daemon is optional, so the doctor would silently break for daemon-less installs; OTLP/gRPC would also drag protobuf into a codebase that deliberately avoids it.
- **Transcript JSONL as the primary source:** rejected — the format is officially unstable; building the headline numbers on it means every Claude Code release can silently corrupt them. As a labeled fallback it is honest; as the foundation it is not.

## Consequences

- Positive: `vkm-doctor` reports real per-day/model/type token usage, cache-hit ratio, cost, and a "broken cache" diagnosis from data that survives across sessions; nothing leaves the machine; no service to install, no admin rights.
- Negative: a background Node process per machine (tiny, but real) and a new local data category under `~/.vkm/telemetry/` the user should know about; the OTLP JSON shape is an external contract that can drift — mitigated by the tolerant parser and raw archiving, verified by a CI round-trip smoke test (sink → POST fixture → `vkm-doctor --json` → exact asserts).
- Neutral: port 4319 is deliberately off the OTLP defaults (4317/4318) to avoid colliding with a user's real collector; the port allocation story is ADR-0048's subject.

## References

- `packages/vkm-doctor/src/otel-sink.mjs` (sink, tolerant `parseOtlpJson`, prune), `packages/create-obsidian-memory/src/telemetry.mjs` (`TELEMETRY_ENV`, SessionStart wiring), `packages/create-obsidian-memory/src/hooks/ensure-otel-sink.mjs`.
- ADR-0042 (vkm-doctor version-locked into the suite), ADR-0048 (port map), ADR-0015 (local-only telemetry stance).

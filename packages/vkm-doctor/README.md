# @vkmikc/vkm-doctor

Local **token & cache doctor** for Claude Code — part of the
[vkm-kit](https://github.com/Vahlame/create-vkm-kit) efficiency suite (ADR-0044). Everything
stays on your machine: no cloud collector, no accounts.

## How it works

- The installer (`npx @vkmikc/create-vkm-kit`, `--ide claude`) points Claude Code's OTEL metrics
  export at a **local sink** via a managed env block, and installs a `SessionStart` hook that
  spawns the sink on demand.
- The sink (`vkm-otel-sink`) is an OTLP/HTTP JSON receiver bound to **`127.0.0.1:4319`**
  (localhost-only, lockfile singleton). Metrics are stored as NDJSON under `~/.vkm/telemetry/`
  and pruned after **90 days**.

## Usage

```bash
vkm-doctor                        # last 30 days: tokens, cost, cache-hit ratio + broken-cache diagnosis
vkm-doctor --days 7               # narrower window
vkm-doctor --json                 # machine-readable output
vkm-doctor --include-transcripts  # adds a clearly-labelled transcript-derived section
```

The cache-hit ratio ships with a diagnosis: a consistently low ratio usually means a broken
prompt cache (something mutating the system prompt every turn) — the single biggest silent cost
multiplier.

`--include-transcripts` parses local Claude Code session transcripts as a **labelled fallback**
(their JSONL format is internal and unstable — the official docs discourage parsing it); it is
reported in its own section, never mixed with the OTEL numbers.

## Install / remove

Wired by default by `create-vkm-kit` when `--ide` includes `claude` and a kit clone is
available. Toggle with `--telemetry` / `--no-telemetry`; full teardown with `--uninstall`.

More: [`docs/observability.md`](../../docs/observability.md) ·
[ADR-0044](../../docs/adr/0044-doctor-telemetry-local-otlp-sink.md).

## License

Free use with mandatory visible attribution (MIT-based) — © Vahlame. See
[`LICENSE.md`](./LICENSE.md).

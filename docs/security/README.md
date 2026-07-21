> [🇪🇸 Español](./README.es.md) · 🇬🇧 English

# Security docs

Deep-dive security notes for the kit. The canonical policy — trust model, scope,
disclosure process — lives in [`SECURITY.md`](../../SECURITY.md) at the repo root.

## Threat model in one paragraph

The kit's boundary is **your filesystem and your git remote** — there is no in-band
authentication, no hosted backend, and nothing leaves the machine by default. The
two active defenses: (1) everything read from the vault or the web is wrapped as
**untrusted DATA, never instructions** (prompt-injection envelope, `_trust` flags),
and (2) supply-chain surface is pinned and verified — `basic-memory` version-pinned,
the obscura binary SHA-256-verified, `gitleaks` scanning history in CI, and
`govulncheck` gating the Go daemon.

## Notes in this directory

| Doc                                        | What it covers                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| [`mcp-remote-rce.md`](./mcp-remote-rce.md) | Why `mcp-remote` must be pinned `>= 0.1.16` on any legacy STDIO↔HTTP bridge. |

Related: telemetry and privacy guarantees are documented in
[`docs/observability.md`](../observability.md) (all sinks local-only).

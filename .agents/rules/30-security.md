## Security

- **No secrets in git.** Use env vars and OS keychains; rotate if leaked.
- **gitleaks** runs in CI (`secrets-scan` workflow) and optionally via initializer pre-commit.
- **Sensitive vault material:** optional **age** encryption (trade-off: harder agent reads); document who holds keys.
- **Telemetry:** OpenTelemetry exporter in the MCP sidecar is **opt-in** (optional deps in `packages/obsidian-memory-mcp`); redact PII in span attributes. Daemon health is exposed locally via `obsidian-memoryd doctor` (heartbeat + last-push + push-failure counter), not via a hosted backend.

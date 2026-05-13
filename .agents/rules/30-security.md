## Security

- **No secrets in git.** Use env vars and OS keychains; rotate if leaked.
- **gitleaks** runs in CI (`secrets-scan` workflow) and optionally via initializer pre-commit.
- **Sensitive vault material:** optional **age** encryption (trade-off: harder agent reads); document who holds keys.
- **Telemetry:** OpenTelemetry / Langfuse are **opt-in**; redact PII in attributes (see `packages/obsidian-memory-mcp`).

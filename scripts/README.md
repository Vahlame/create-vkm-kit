# `scripts/`

- **`sync-agents.ts`** — regenerates `AGENTS.md`, `.cursor/rules`, `.continue/rules` from `.agents/` and `agents-manifest.yaml`.

**`scripts/windows/`** contained example Windows integration scripts; they were **removed in v3** (script-free public kit). See [`docs/migration/v2-to-v3-script-free-kit.md`](../docs/migration/v2-to-v3-script-free-kit.md).

CI still runs **`.github/scripts/extract-and-lint.ps1`** against the archived v1 prompt when that workflow is enabled.

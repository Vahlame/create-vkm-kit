# ADR-0008: Ship `Vault-Doctor.ps1` as the canonical vault health audit

## Status

Accepted

## Context

Install-time validation (`Doctor.ps1`) checks toolchain, `mcp.json`, MCP health endpoint, and that scheduled tasks exist. It does not inspect vault _content_: oversized notes, missing frontmatter, duplicate headings, broken wikilinks, accidental secrets, or tasks that invoke `powershell.exe` directly (which flashes a console window every run).

Users with long-running vaults reported drift and noise (empty folders, duplicate session headers, legacy installer files at repo root).

## Decision

1. Keep **`Doctor.ps1`** for **connectivity / install smoke** (unchanged purpose).
2. Add **`Vault-Doctor.ps1`** for **vault structure and hygiene** (read-only except optional `REVIEW_YYYY-MM-DD.md` when `-WriteReview` is passed).
3. Embed `Vault-Doctor.ps1` literally in `PROMPT_ULTRA_COMPLETO.md` section 8 (same contract as other scripts: generated only inside the user's private vault).
4. Default vault path is a **parameter** (`-VaultPath`) with default `$HOME\Documents\cursor-memory-vault` so the script is not tied to one machine's username string.
5. `Setup-Cursor-Memory.ps1` runs `Doctor.ps1` then `Vault-Doctor.ps1` at the end of a successful setup so the agent's final report includes both layers.

## Consequences

- One more script to maintain in the prompt; CI lints it via `extract-and-lint.ps1`.
- Fresh installs may show `WARN` from `Vault-Doctor` (e.g. low frontmatter coverage) until the user or agent normalizes notes; `FAIL` should be rare if no secrets are pasted.

## Alternatives considered

- **Replace `Doctor.ps1` with a single mega-script** — rejected: connectivity checks are fast and familiar; content audits are slower and deserve a separate name and exit semantics.
- **Run Vault-Doctor only manually** — rejected: shipping it in setup surfaces hygiene issues on day one.

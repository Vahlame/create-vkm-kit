# ADR-0041: vkm-kit rename — brand now, machine identifiers dual-read, wire contracts frozen

- **Status:** Accepted (shipped; package is `@vkmikc/create-vkm-kit`)
- **Date:** 2026-07-10
- **Deciders:** maintainer

## Context

The repo outgrew its name: `obsidian-memory-kit` now ships a token-saver, a telemetry doctor, single-call context assembly, a spec pipeline and discipline skills (ADR-0043→0049) — a Claude Code efficiency suite in which the Obsidian vault is one pillar, not the product. The maintainer decided to rename the brand to **vkm-kit** for the 4.0.0 train (ADR-0050); the npm scope stays `@vkmikc`.

The hard part is not the new name but the old one, which lives in durable machine state on every existing install: the ownership marker `create-obsidian-memory` inside every hook file this kit ships (checked by `isKitOwnedFile` before `--uninstall` deletes anything), the `<!-- obsidian-memory:start/end -->` sentinels around the managed CLAUDE.md block, `OBSIDIAN_MEMORY_*` env vars, users' `permissions.allow` entries of the form `mcp__obsidian-memory-hybrid__*`, the `obsidian-memoryd` service binary, and `BASIC_MEMORY_HOME`. npm additionally has **no redirects**: a renamed package is simply a different package, and installs pinned to the old name break silently.

## Decision

A three-tier rename policy, executed as the last phase of the 4.0.0 train (ADR-0050):

1. **Brand renames now.** Repo, README/docs, package dir `create-obsidian-memory` → `create-vkm-kit`, bins `create-vkm-kit` + short alias `vkm`. GitHub's repo redirects cover clones and links.
2. **Machine identifiers go dual-read: write-new, accept-legacy for ≥2 majors.** `KIT_FILE_MARKER` becomes `"vkm-kit"` while `LEGACY_FILE_MARKERS` (already exported empty in `settings-io.mjs` for exactly this moment) gains `"create-obsidian-memory"`, so ownership checks recognize files installed by any older release. New sentinels `<!-- vkm-kit:start/end -->` are written, and an existing `obsidian-memory:start` block is migrated **in place** — one block after upgrade, never two. Env resolution reads `VKM_*` first and falls back to `OBSIDIAN_MEMORY_*`.
3. **Frozen — never renamed:** the MCP server key `obsidian-memory-hybrid` (renaming it would invalidate every user's `permissions.allow mcp__obsidian-memory-hybrid__*` entries, reintroducing permission prompts or silent tool denials); the `obsidian-memoryd` binary (OS service registrations and scripts reference it by name); `BASIC_MEMORY_HOME` (upstream basic-memory's env contract — not this kit's to rename).
4. **npm:** publish `@vkmikc/create-vkm-kit`; keep `@vkmikc/create-obsidian-memory` alive as a thin forwarding shim that executes the new package, then `npm deprecate` the old name with a pointer. The old name is never unpublished (ADR-0050). — **Superseded 2026-07-20 (ADR-0050 amendment):** the shim never reached npm (the granular token lacked write on the old name; npm reports that as a 404). The old name stays deprecated and **frozen on the v3 kit 3.15.0** — it does not forward, and `release.yml` no longer tries to publish it.

## Alternatives considered

- **Clean-slate rename of every identifier (markers, sentinels, MCP key, env, binary):** the "consistent" option, rejected — it converts a branding change into a breaking migration for every installed surface at once, including surfaces (MCP permissions, service registrations) the installer cannot safely rewrite on the user's behalf.
- **Keeping the old name and treating vkm-kit as a tagline:** rejected — the name misdescribes the product to new users, and the longer the suite ships under the old identity the more durable state accretes against a future rename.
- **npm alias/republish without a shim:** rejected — npm has no redirects, so users of the old name would silently stop receiving updates; a forwarding shim plus `npm deprecate` keeps them working while telling them why to move.

## Consequences

- Positive: upgrades from 3.x land on one migrated managed block and reconciled hooks with zero manual steps; nothing a user granted permissions to changes its identity; the deprecation path is informative instead of punitive.
- Negative: dual-read logic (two markers, two sentinel forms, two env prefixes) is permanent surface area for ≥2 majors and must be exercised by migration fixtures, not assumed; the frozen MCP key means the brand inconsistency (`vkm-kit` suite, `obsidian-memory-hybrid` server) is deliberate and forever.
- Neutral: the shim package is a few lines of forwarding and rides the same release pipeline (ADR-0050); Proposed until the rename phase actually executes.

## References

- `packages/create-obsidian-memory/src/settings-io.mjs` (`KIT_FILE_MARKER`, `LEGACY_FILE_MARKERS` placeholder), `packages/create-obsidian-memory/src/memory-rules.mjs` (`RULES_START` sentinel).
- ADR-0042 (version-locked suite), ADR-0050 (rename sequenced last in the train).

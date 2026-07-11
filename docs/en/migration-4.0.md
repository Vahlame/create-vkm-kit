> [🇪🇸 Español](../es/migracion-4.0.md) · 🇬🇧 English

# Migrating to 4.0 (the kit is now called vkm-kit)

In 4.0.0 the kit is renamed from `obsidian-memory-kit` to **vkm-kit**: an efficiency suite for
Claude Code — persistent vault memory + token-saver + local usage doctor + spec-builder. The
**brand** changes (repo, npm, bins, docs); **nothing your installs depend on changes**. The why
and the technical detail: ADR-0041 and ADR-0050 in [`docs/adr/`](../adr/).

## What changed

| Before                                         | Now                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Repo `github.com/Vahlame/obsidian-memory-kit`  | `github.com/Vahlame/create-vkm-kit` (the old URL redirects)                                             |
| npm `@vkmikc/create-obsidian-memory`           | `@vkmikc/create-vkm-kit` (the old name keeps working as a shim)                                         |
| Bin `create-obsidian-memory`                   | Bins `create-vkm-kit` plus the short alias `vkm`                                                        |
| Directory `packages/create-obsidian-memory/`   | `packages/create-vkm-kit/`                                                                              |
| Sentinels `<!-- obsidian-memory:start/end -->` | `<!-- vkm-kit:start/end -->` (a 3.x block is migrated **in place**: one block after upgrade, never two) |

`VKM_*` variables (e.g. `VKM_VAULT`) are read first, falling back to the legacy names — your
existing configuration keeps working as-is.

## What does NOT change (deliberately frozen)

These identifiers live in durable state on your installs (permissions, services, scripts) and
are **never renamed** — your `permissions.allow` entries and MCP registrations keep working
untouched:

- The MCP server key **`obsidian-memory-hybrid`** (and the tool names
  `mcp__obsidian-memory-hybrid__*`).
- The **`obsidian-memoryd`** daemon (OS service registrations reference it by name).
- The **`BASIC_MEMORY_HOME`** env var (upstream basic-memory's contract, not this kit's) and the
  **`OBSIDIAN_MEMORY_*`** env vars (still accepted).
- The Python package **`obsidian-memory-rag`** and the npm package
  **`@vkmikc/obsidian-memory-mcp`**.
- The rule file **`.cursor/rules/obsidian-memory.mdc`**.
- The default vault **`~/Documents/obsidian-memory-vault`**.

## How to upgrade

One command:

```bash
npx @vkmikc/create-vkm-kit --full
```

It recognizes what 3.x installed and **migrates it in place**: rewrites the managed block with
the new sentinels (never duplicating it), reconciles the hooks, and keeps your configuration.
If you have scripts pinned to the old name, `npx @vkmikc/create-obsidian-memory` keeps working:
it is a shim that forwards to the new package (deprecated with a pointer, never unpublished).
Afterwards, restart Claude Code / Codex (or reload the Cursor window) so the next session picks
up the changes.

## What's new in 4.0.0, in one paragraph

The **token-saver** compacts noisy tool output before it enters context — ≥30% reduction with
zero diagnostic loss, with the `VKM_TOKEN_SAVER=0` kill switch —; **`vkm-doctor`** adds a local
OTLP sink (127.0.0.1:4319) and a token/cost/cache report **that never leaves your machine**;
**`assemble_context`** returns in **one** budgeted call the project context that used to cost
3–6 chained searches (median −68% wire tokens, CI-gated); **`vkm-spec`** turns a one-line idea
into a vault-grounded XML spec (GUI on `127.0.0.1:4923`, optional Ollama `phi4-mini` draft with
a deterministic fallback that always works); and the **`/vkm-discipline`** and **`/vkm-spec`**
skills bring that discipline into the Claude Code session.

## Uninstall

```bash
npx @vkmikc/create-vkm-kit --uninstall          # add --dry-run to preview
```

It reverses everything the kit installed (hooks, managed block, skills, telemetry) and is
**hash-guarded**: files you modified by hand are detected and **not** deleted.

# ADR-0079: One brand, and three tiers of how frozen a name is

- **Status:** Accepted
- **Date:** 2026-07-27
- **Deciders:** maintainer

## Context

Nine product names are in simultaneous use, and no file says which is which:

| Name                                                                       | Where it lives                          |
| -------------------------------------------------------------------------- | --------------------------------------- |
| `create-vkm-kit`                                                           | the repo, and the Go module path        |
| `vkm-kit`                                                                  | the private root package; the brand     |
| `@vkmikc`                                                                  | the npm scope                           |
| `@vkmikc/create-vkm-kit`, bins `create-vkm-kit` and `vkm`                  | the one published package               |
| `@vkmikc/obsidian-memory-mcp`, `@vkmikc/obscura-web`, `@vkmikc/vkm-doctor` | private workspace packages              |
| `obsidian-memory-rag`                                                      | the Python distribution                 |
| `obsidian-memoryd`                                                         | the Go daemon and its installed service |
| `obsidian-memory-hybrid`                                                   | an MCP server id in users' config files |
| `@vkmikc/create-obsidian-memory`                                           | a retired npm name, frozen at 3.15.0    |

`git grep -il obsidian` matches 243 of 768 tracked files; `git grep -io obsidian | wc -l`
is 1,565. Meanwhile `docs/en/glossary.md` states that the Obsidian desktop app is not
needed at all, and `docs/en/how-it-works.md` says the kit does **not** require it. The
product is plain Markdown under git; the name promises a dependency the documentation
spends paragraphs denying.

The temptation is to rename everything. That would break users, and the breakage would be
of the worst kind: silent, on their machine, unfixable by the installer. So the useful
decision is not "rename" — it is **saying which names are ours to change and which are
not**, and why.

## Decision

`vkm` is the brand. Every name falls into exactly one of three tiers.

### Tier 1 — ours, safe to rename

No durable user state depends on these. They are private packages and internal paths:

| Today                           | Target                     |
| ------------------------------- | -------------------------- |
| `packages/obsidian-memory-mcp/` | `packages/vkm-memory-mcp/` |
| `packages/obsidian-memory-rag/` | `packages/vkm-memory-rag/` |
| `cmd/obsidian-memoryd/`         | `cmd/vkm-syncd/`           |

**Scheduled, not done in 5.0.** A rename here touches the most gates of any change in the
repo — `version:check`, `license:sync:check`, `sync-agents:check` (regenerated, never
hand-edited), `linkcheck`, `typecheck`, `test-python`, `test-go`, `e2e-smoke`,
`mcp-smoke`, `harness-matrix` — and it is purely mechanical. Landing it in the same
release as the structural refactor would make both harder to review and a bisect useless.
It gets its own change.

Note the exception inside the exception: `cmd/vkm-syncd/` may be renamed, but the BUILT
BINARY and the INSTALLED SERVICE keep the name `obsidian-memoryd` for one more major.
An existing systemd unit or launchd plist points at it by name.

### Tier 2 — frozen, byte-stable, must not change in 5.x

Each of these lives in a file the kit does not own, or in an upstream contract. A rename
is a silent breakage the installer can neither detect nor repair.

- **The published npm name `@vkmikc/create-vkm-kit` and its bins `create-vkm-kit`, `vkm`.**
  npm has no redirects (ADR-0050). A rename orphans every pinned install and every `npx`
  line in every script and blog post.
- **The bin target path `packages/create-vkm-kit/src/index.js`, including the `.js`
  extension** — the repo's only `.js` file, and deliberately so. It is named by the
  `package.json` bin map, `scripts/harness-matrix.mjs`, `scripts/e2e-smoke.mjs`,
  `evals/lib/arm-install.mjs`, `AGENTS.md`, ~14 doc lines, and a link in `ARCHITECTURE.md`
  that `npm run linkcheck` resolves on disk. Renaming it to `.mjs` also forces a
  package-lock regeneration, and the lock records the bin map and is itself a
  `version:check` marker (ADR-0077).
- **The four MCP server ids** written into users' `mcp.json` and client config:
  `basic-memory`, `obsidian-memory-hybrid`, `obscura-web`, `vkm-downloads`.
  `obsidian-memory-hybrid` is doubly frozen — `mcp__obsidian-memory-hybrid__*` tool names
  are baked into users' own `CLAUDE.md` files, outside this repository entirely.
- **`BASIC_MEMORY_HOME`** — an upstream basic-memory contract, not ours to rename.
- **All `OBSIDIAN_MEMORY_*` environment variables.** They may gain `VKM_*` aliases; the
  old names keep working as read-only aliases (`rag-client.mjs` already resolves three
  spellings for one concept and must keep doing so).
- **The default vault path `~/Documents/obsidian-memory-vault`.** Changing it makes an
  existing install silently point at an empty directory: the user's memory appears to have
  vanished.
- **The 30 Python CLI subcommand names**, in particular the twelve `json-*` the Node
  bridge spawns by name and the `bench-*` names CI invokes by name. The `cli.py`
  decomposition may move every line of implementation; it may not rename one subcommand.

### Tier 3 — converge on `~/.vkm/`

State the kit writes outside the repo drifted across three roots. Converge on `~/.vkm/`
with a one-time migration that moves what exists and leaves a pointer, never a silent
relocation.

## Alternatives considered

- **Rename everything to `vkm-*`, including the MCP ids.** Rejected. It is the only option
  that makes the grep count go to zero, and it is exactly the option that breaks a user's
  machine in a way no code here can fix.
- **Keep `obsidian-*` everywhere and drop the `vkm` brand.** Rejected on positioning: the
  product's own glossary says the Obsidian app is not required, and a name that promises
  otherwise costs adoption for no benefit.
- **Alias every frozen name and deprecate slowly.** Rejected for the MCP ids specifically:
  an alias means two live entry points into the same server, and the failure mode of a
  half-migrated `mcp.json` is worse than the naming inconsistency it fixes.
- **Say nothing and decide per-rename.** Rejected — that is the state this ADR exists to
  end. The repo already renamed once (ADR-0041) and the question came back.

## Consequences

- Positive: "may I rename this?" has a written answer, and the answer for the dangerous
  cases is no, with the reason attached.
- Positive: the ~1,565 `obsidian` occurrences become a bounded, named compatibility set
  rather than an open question.
- Negative: the identifier count does not drop in 5.0. Tier 1 is scheduled, not done, and
  the frozen tier is permanent by design — the repo will keep both brands visible.
- Neutral: `vkm` is a brand prefix, not an acronym — there is no expansion to give, and
  inventing one would be worse than leaving it. Both glossaries now say that explicitly and
  list where the prefix appears, so a reader stops looking for a meaning that is not there.

## References

- [ADR-0041](./0041-vkm-kit-rename-and-back-compat.md) — the first rename, and the
  dual-read machine identifiers this ADR generalizes.
- [ADR-0050](./0050-release-train-and-npm-shim.md) — why the old npm name is frozen and
  unpublished.
- [ADR-0077](./0077-lockfile-is-a-version-marker.md) — why the lockfile constrains the bin map.
- `scripts/version.mjs`, `scripts/license-sync.mjs` — both now derive the package list
  from `packages/*`, so a Tier-1 rename does not need either to be hand-edited.

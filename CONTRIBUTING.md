# Contributing

Thanks for considering a contribution. This repository ships **cross-platform** guidance (`AGENTS.md`) and optional **Go** and **Node** tooling.

## What this repo is and is not

- **Is:** cross-platform agent memory guidance (`AGENTS.md`), MCP sample configs, optional Go daemon, and initializer.
- **Is not:** a hosted SaaS. You run MCP servers and vaults locally (or in your infra).

## Before you open a PR

1. Read `AGENTS.md` and `CHANGELOG.md`. Design decisions live in `docs/adr/`; do not undo them without a new ADR.
2. For behavior touching Windows/Linux/macOS, validate on at least one target OS when feasible.
3. Run the local checks below.

**Workspace Git defaults:** `.vscode/settings.json` in this repo deliberately turns off aggressive Git SCM polling (`git.autorefresh`, `git.autofetch`) and excludes noisy paths from the file watcher so Windows does not spawn `git`/`conhost` in a tight loop while you work. If you change it, document why in the PR (some contributors prefer live SCM).

## Local checks

```bash
npm ci
npm run sync-agents:check

# Markdown lint (version pinned to match .github/workflows/ci.yml exactly — an
# unpinned `npx markdownlint-cli` can silently resolve a newer release with different
# formatting rules than CI enforces, passing locally and failing in CI)
npx markdownlint-cli@0.49.0 "**/*.md" --ignore-path .markdownlintignore

# Formatting (version pinned for the same reason)
npx prettier@3.8.4 --check "**/*.{json,yml,yaml,md,mjs,js,cjs,ts}"

# Link check
npx lychee --no-progress .

# Go tests (requires Go 1.22+)
go test ./...
go test ./... -race   # CI also runs the race detector on Linux

# Python RAG tests
pip install -e ./packages/obsidian-memory-rag
pytest packages/obsidian-memory-rag/tests
```

All must pass. CI mirrors these in `.github/workflows/ci.yml`.

## Previewing visual assets (SVG diagrams)

`docs/assets/*.svg` are theme-aware (`prefers-color-scheme`), and browser panes in
agent tooling commonly block `file://` navigation. To check them in a live browser:

```bash
npm run preview:assets   # http://127.0.0.1:4180/ → docs/assets/ listing
```

Read-only, localhost-only, traversal-safe. For the dark variant, flip your OS theme
or use DevTools → Rendering → "Emulate CSS prefers-color-scheme: dark". Verify both
themes before shipping an asset change.

## Types of changes

| Change                                   | Where it goes                  | Needs an ADR? |
| ---------------------------------------- | ------------------------------ | ------------- |
| Typo, wording, clarification             | the file in question           | no            |
| Known-error addition                     | `docs/troubleshooting.md`      | no            |
| New design decision                      | new file in `docs/adr/`        | **yes**       |
| Cross-platform installer / daemon change | `cmd/`, `packages/`, `config/` | yes           |
| Breaking change to agent contract        | discuss in an issue first      | yes           |

## Commit messages

Use imperative mood, lowercase, no trailing period, under 72 chars. Look at recent commits for style:

```text
harden ultra prompt: 7 fixes for real-world gaps
trim repo to prompt + readme; agent generates scripts locally
```

## Releasing

The maintainer cuts releases. The release process is:

1. Update `CHANGELOG.md` (Keep a Changelog format).
2. Bump version in `agent.toml` -> `version` when releasing.
3. Tag `vX.Y.Z` and push.
4. GitHub Actions publishes a Release with notes copied from `CHANGELOG.md`.

SemVer interpretation for this repo (rewritten for the kit era — the original wording predated the prompt→kit pivot):

- **MAJOR**: the installed contract breaks — a CLI flag or default removed/renamed, an MCP tool renamed or removed, a vault-layout or hook change that forces the user to migrate. Every major ships with a migration guide (`docs/en/migration-X.md` / `docs/es/migracion-X.md`).
- **MINOR**: new tools, flags, docs or install modes, backwards-compatible.
- **PATCH**: fixes, wording, internal cleanups.

### Versioning policy (post-4.x)

The 1.x→4.x run in two months tracked a product pivot — v1 operational prompt → v2 vault+MCP stack → v3 script-free kit → v4 rename ([ADR-0041](docs/adr/0041-vkm-kit-rename-and-back-compat.md)) — not API instability. From 4.x on, **majors are frozen** except for unavoidable contract breaks: breaking changes are batched into a single planned major with its migration doc, never dripped across releases. When in doubt whether a change is MAJOR, open an issue first (see the ADR table above).

## Security

Do not include secrets, tokens, or real user paths in PRs. See `SECURITY.md` for how to report vulnerabilities.

## License

By contributing you agree your contribution is licensed under the repository's free-use-with-mandatory-attribution license — see [`LICENSE.md`](LICENSE.md).

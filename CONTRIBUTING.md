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

# Markdown lint
npx markdownlint-cli "**/*.md" --ignore-path .markdownlintignore

# Formatting
npx prettier --check "**/*.{json,yml,yaml,md,mjs,js,cjs,ts}"

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

SemVer interpretation for this repo:

- **MAJOR**: prompt section numbers change, or the agent contract breaks (e.g., a new mandatory parameter the user must provide).
- **MINOR**: new optional sections, new scripts, new docs, new known-error entries.
- **PATCH**: typos, wording, internal cleanups.

## Security

Do not include secrets, tokens, or real user paths in PRs. See `SECURITY.md` for how to report vulnerabilities.

## License

By contributing you agree your contribution is licensed under the MIT License.

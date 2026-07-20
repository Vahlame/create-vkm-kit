<!--
Thanks for the PR. Please fill in the blanks below.
Keep PRs focused: one change per PR.
-->

## Summary

<!-- What does this PR change and why? 1-3 sentences. -->

## Type of change

- [ ] Typo / wording / clarification
- [ ] Installer / wizard (`packages/create-vkm-kit`)
- [ ] MCP server (`packages/obsidian-memory-mcp`, `obscura-web`, `vkm-downloads`, `vkm-spec`)
- [ ] Sync daemon (`cmd/obsidian-memoryd`)
- [ ] RAG / retrieval (`packages/obsidian-memory-rag`)
- [ ] New troubleshooting entry (`docs/en/troubleshooting.md`)
- [ ] New design decision (includes an ADR in `docs/adr/`)
- [ ] Docs only
- [ ] CI / tooling

## Validation

See `CONTRIBUTING.md` → **Local checks** for the exact commands (they mirror the
`lint` job in order).

- [ ] `npm ci` then the full **Local checks** block passes
- [ ] `npm test --workspaces --if-present` passes
- [ ] `go test ./...` passes (if Go code touched)
- [ ] `pytest packages/obsidian-memory-rag/tests` passes (if Python touched)
- [ ] Retrieval benches still meet their floors (if retrieval touched — see `evals/`)
- [ ] I updated `CHANGELOG.md` under `[Unreleased]`

<!-- The external link check (lychee), gitleaks, govulncheck, mcp-smoke and the
benches run in CI; you are not expected to reproduce all of them locally. -->

## Tested on

<!-- If you touched anything platform-sensitive (paths, hooks, the daemon, the
installer), say where you actually ran it. -->

- OS:
- Node:
- Agent (Claude Code / Cursor / Codex / Cline / Continue / Copilot):

## Checklist

- [ ] No secrets, tokens, or absolute personal paths in this diff
- [ ] If I touched architecture, I added or updated an ADR

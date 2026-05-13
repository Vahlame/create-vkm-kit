<!--
Thanks for the PR. Please fill in the blanks below.
Keep PRs focused: one change per PR.
-->

## Summary

<!-- What does this PR change and why? 1-3 sentences. -->

## Type of change

- [ ] Typo / wording / clarification
- [ ] Script / daemon fix (`cmd/`, `packages/`, `docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md`)
- [ ] New known-error entry (`docs/troubleshooting.md`)
- [ ] New design decision (includes ADR in `docs/adr/`)
- [ ] Cross-platform / MCP / initializer change
- [ ] Docs only
- [ ] CI / tooling

## Validation

- [ ] `npm ci && npm run sync-agents:check` passes
- [ ] `npx markdownlint-cli "**/*.md" --ignore-path .markdownlintignore` passes
- [ ] `npx prettier --check "**/*.{json,yml,yaml,md}"` passes
- [ ] `npx lychee --no-progress --exclude-mail .` passes
- [ ] `pwsh -File .github/scripts/extract-and-lint.ps1` passes (legacy v1 prompt)
- [ ] `go test ./...` passes (if Go code touched)
- [ ] I updated `CHANGELOG.md` under `[Unreleased]`
- [ ] If this is a breaking change, I bumped `version` in `agent.toml`

## Tested on

<!-- If you touched the prompt or any generated script, paste the OS / PS / Node versions you tested with. -->

- OS:
- PowerShell:
- Node:
- Cursor:

## Checklist

- [ ] No secrets, tokens, or absolute personal paths in this diff
- [ ] If I touched architecture, I added or updated an ADR

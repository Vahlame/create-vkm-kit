# ADR-0013: Syncthing as an optional sync transport

- **Status:** Accepted
- **Date:** 2026-05-13
- **Deciders:** maintainer

## Context

Git remains the audit-grade source of truth for Markdown memory, but some teams already synchronize vault folders with **Syncthing** for multi-device latency lower than `git push`. Conflicts appear as `*.sync-conflict-*.md` files, which are painful for agents and humans.

## Decision

Treat **Syncthing as an optional transport layer** complementary to Git: the Go daemon’s watcher attempts **three-way `git merge-file`** when conflict-marked Syncthing files appear; if merge fails, files stay visible for manual resolution. Documentation positions Git + private GitHub as default; Syncthing is advanced/opt-in.

## Consequences

- **Positive:** Meets users where they already sync; reduces “silent clobber” risk when combined with Git commits.
- **Negative:** Automated merge is best-effort only; binary or large attachments still need human policy.
- **Neutral:** No requirement to install Syncthing for the default path.

## Alternatives considered

- **Ignore Syncthing conflicts:** Rejected — leaves landmines in the vault.
- **Syncthing instead of Git:** Rejected — weak audit trail for agent memory.

## References

- `cmd/obsidian-memoryd/` (watch command implementation notes)

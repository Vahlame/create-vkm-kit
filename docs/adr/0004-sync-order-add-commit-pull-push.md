# ADR-0004: Sync order is `add -> commit -> pull --rebase -> push`

- **Status:** Accepted
- **Date:** 2026-05-13

## Context

Unattended vault git automation (any cadence you choose; **this kit’s docs** steer you toward **`obsidian-memoryd watch`** or **manual git** rather than bundled PowerShell files). If we attempt `git pull --rebase` while the working tree has unstaged changes, Git refuses with:

```text
cannot pull with rebase: You have unstaged changes.
```

If we attempt `git push` before pulling, we get rejected when another machine has already pushed.

## Decision

The fixed order is:

1. `git add -A`
2. `git commit -m "memory sync <timestamp>"` (only if there is anything staged)
3. `git pull --rebase origin <branch>`
4. `git push origin <branch>`

This works whether or not there are local changes, and recovers cleanly from a remote that has moved ahead.

## Alternatives considered

- **`git stash` + pull + pop.** Adds steps and can leak conflict markers into committed files if not handled.
- **`git pull --autostash`.** Works on newer Git, but not all Git for Windows builds ship with a default that includes it cleanly; we want to be conservative.
- **Force push.** Throws away data on conflict. Hard no.

## Consequences

- **Positive:** Robust, idempotent, works on every Git for Windows version in the wild.
- **Negative:** Each run creates a commit even when only whitespace changed in the chat-driven edits. Mitigation: only commit when `git status --porcelain` is non-empty.
- **Neutral:** Commit messages are timestamped and not human-curated. Acceptable for a memory log.

## References

- `PROMPT_ULTRA_COMPLETO.md` section 4, item 4; section 8.3.

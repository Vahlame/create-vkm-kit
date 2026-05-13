# ADR-0007: Windows-first; other platforms via separate prompt variants

- **Status:** Accepted
- **Date:** 2026-05-13

## Context

The author's day-to-day machine is Windows. The first end-to-end successful install of this pattern was on Windows. Many of the design decisions (Task Scheduler, VBS shim, PowerShell 5.1-compatible JSON merge, `%USERPROFILE%`) are Windows-specific.

We could try to write one prompt that handles all three platforms, but doing so would either:

- multiply the size and conditional branching of the prompt (and prompt size already matters for the agent's attention budget), or
- ship a lowest-common-denominator design that does not feel native on any platform.

## Decision

The canonical **v1** ultra-prompt is Windows-only. Cross-platform support was originally described as separate monolithic prompt files:

- `PROMPT_ULTRA_COMPLETO.macos.md` (uses `launchd`, `nohup`, `~/Library/Application Support`).
- `PROMPT_ULTRA_COMPLETO.linux.md` (uses `systemd --user`, `~/.config`).

**v2 update:** those filenames now exist at the repository root as **short redirect documents** pointing to the cross-platform README / `AGENTS.md` flow, so Linux/macOS users are not left searching. Full step-by-step v1 prose remains only for Windows in `docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md`.

Each variant is independently testable and independently versioned. The README explicitly states "Windows-first" and links to whichever variants exist.

## Alternatives considered

- **One monolithic prompt with `if Windows / if macOS / if Linux` branches.** Doubles the size, increases the chance the agent picks the wrong branch.
- **Drop the promise of cross-platform.** Considered, but Linux/macOS users are a significant fraction of Cursor's audience and the pattern is fundamentally portable.

## Consequences

- **Positive:** Each variant feels native and can be reviewed by maintainers familiar with that platform.
- **Negative:** Three documents to keep in sync if a structural change happens. Mitigation: tag releases together and use a shared `docs/adr/` so design decisions only need one source of truth.
- **Neutral:** Linux/macOS users follow **v2** README / root redirect stubs (`PROMPT_ULTRA_COMPLETO.{linux,macos}.md`) instead of translating the full Windows-only v1 prompt.

## Amendment (2026-05-13)

The repo now ships **stub** `PROMPT_ULTRA_COMPLETO.{linux,macos}.md` files at the root (redirect to v2). They intentionally **do not** duplicate the full v1 ultra-prompt; operational detail lives in `README.md`, `AGENTS.md`, and `docs/migration/v1-prompt-closure.md`.

## References

- `PROMPT_ULTRA_COMPLETO.md` section 1; section 13 ("este flujo es Windows-first") — historical v1 path; archived copy: `docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md`.
- `README.md` / `README.en.md` migration sections.
- Root `PROMPT_ULTRA_COMPLETO.linux.md`, `PROMPT_ULTRA_COMPLETO.macos.md`.

# Archived Windows Task Scheduler automation

Historical installs used **PowerShell blocks** embedded in the long-form prompt under `docs/legacy/` plus **Task Scheduler** (watchdog + auto-sync). Those scripts are **not copied here verbatim**; they stay in that tree for reproduction only.

## What replaced them

- **`obsidian-memoryd`** (`cmd/obsidian-memoryd/`) — cross-platform watcher + git sync.
- **Optional Syncthing** — see ADR-0013.

## If you must maintain an old Windows-only install

1. Read [`docs/legacy/README.md`](../README.md) for what lives on disk.
2. Extract PowerShell blocks with `.github/scripts/extract-and-lint.ps1` (paths in that script point at the legacy prompt file).
3. Treat artifacts as **frozen** — move to the current kit in [`README.md`](../../../README.md) when feasible.

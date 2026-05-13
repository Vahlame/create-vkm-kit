# Windows v1 automation (deprecated)

v1 relied on **PowerShell scripts embedded** in `docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md` plus **Task Scheduler** (watchdog + auto-sync). Those scripts are **not copied here verbatim** (they remain inside the archived prompt for historical reproduction).

## What replaced them

- **`obsidian-memoryd`** (`cmd/obsidian-memoryd/`) — cross-platform watcher + git sync.
- **Optional Syncthing** — see ADR-0013.

## If you must maintain a legacy Windows install

1. Open `docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md`.
2. Extract the PowerShell blocks using `.github/scripts/extract-and-lint.ps1` (default path points to the legacy prompt).
3. Treat all artifacts as **frozen** — migrate to v2 when feasible.

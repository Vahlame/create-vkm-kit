# ADR-0012: Cross-platform Go daemon (`obsidian-memoryd`) replaces PowerShell + Task Scheduler

- **Status:** Accepted
- **Date:** 2026-05-13
- **Deciders:** maintainer

## Context

v1 used PowerShell scripts plus Windows Task Scheduler (watchdog, autosync). That locked operational automation to Windows and duplicated glue (logging, git sync, process supervision) outside the MCP path. ADR-0006 (“no runnable scripts in this repo”) applied when the product was “prompt-only”; v2 intentionally ships **maintained automation** in this repository.

## Decision

Ship a **single static Go binary** `obsidian-memoryd` with subcommands for user-level service installation (`systemd --user`, `launchd` LaunchAgent, Windows user service via `kardianos/service`), foreground `watch` with `fsnotify` + debounced git sync, `sync once`, log inspection, and `self-update` with SHA256 verification. Logs use **`log/slog` JSON** with rotation via `lumberjack`, stored under the XDG state directory / OS equivalents. v1 PowerShell and task XML are **moved to `docs/legacy/windows-v1/`** with a deprecation README.

## Consequences

- **Positive:** One build matrix for Linux/macOS/Windows; predictable packaging; no PowerShell version matrix for the daemon path.
- **Negative:** Contributors need Go 1.22+ for daemon changes; service install behavior varies by OS and permissions.
- **Neutral:** Users may still choose Syncthing-only flows without the daemon (see ADR-0013).

## Alternatives considered

- **Stay with PowerShell + schtasks:** Rejected — not cross-platform.
- **Node/Tauri watcher:** Rejected — heavier runtime than a small static binary for a background agent.

## References

- `cmd/obsidian-memoryd/`
- `docs/legacy/windows-v1/README.md`

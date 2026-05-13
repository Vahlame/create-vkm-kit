# Windows: sync the vault with git (no kit scripts)

This guide does **not** ship or ask you to copy `.ps1`, `.vbs`, or `.bat` from the repo. Pick one path.

## Option A (recommended): `obsidian-memoryd watch` (Go)

Save-triggered sync with debounce (default **45 s** after the last change; tune with `OBSIDIAN_MEMORY_DEBOUNCE`).

**No console windows on Windows:** the repo ships two build-tag files:
- `proc_windows.go` — each `git` subprocess receives `CREATE_NO_WINDOW + HideWindow: true`; zero console flashes even when the `.exe` is GUI-subsystem (`-H windowsgui`).
- `proc_other.go` — no-op on Linux/macOS.

Build command for Windows (no console):
```bash
go build -ldflags="-H windowsgui" -o bin/obsidian-memoryd.exe ./cmd/obsidian-memoryd
```

Silent start: a **Startup folder shortcut** pointing at the `.exe`, arguments `watch`, **Start in** = vault root. Do not wrap in `cmd.exe`. Tune cadence: `setx OBSIDIAN_MEMORY_DEBOUNCE 2m`.

## Option B: manual git only

In a terminal at the vault root, when you want to converge with the remote:

```bash
git status
git add -A
git commit -m "memory"   # only if there are changes
git pull --rebase
git push
```

Safe order: **add → commit (if needed) → pull --rebase → push** ([ADR-0004](../adr/0004-sync-order-add-commit-pull-push.md)). Running `pull --rebase` with unstaged changes yields _cannot pull with rebase: You have unstaged changes_.

## Option C: memory inside the repo you already `git pull`

No extra timer just for the vault: [`memory-repo-sin-automatismos-locales.en.md`](./memory-repo-sin-automatismos-locales.en.md).

## Task Scheduler (advanced, self-maintained)

If you register your own task that runs `git` or another binary, use the Task Scheduler UI to inspect the command line and history exit codes. This repo does not include copy-paste PowerShell/VBS task templates.

## Spanish

Mismo contenido: [`windows-scheduled-vault-sync.md`](./windows-scheduled-vault-sync.md).

# Windows: sync the vault with git (no kit scripts)

This guide does **not** ship or ask you to copy `.ps1`, `.vbs`, or `.bat` from the repo. Pick one path.

## Option A (recommended): `obsidian-memoryd watch` (Go)

Save-triggered sync with debounce (default **45 s** after the last change; tune with `OBSIDIAN_MEMORY_DEBOUNCE`). Requires **Go**, build from this repo, run the binary with `BASIC_MEMORY_HOME` pointing at the vault. See [`cmd/obsidian-memoryd`](../../cmd/obsidian-memoryd), `agent.toml`, and on Windows build with `go build -ldflags="-H windowsgui"` if you register the binary in Task Scheduler **as the program** (path to `.exe`) without kit wrapper scripts.

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

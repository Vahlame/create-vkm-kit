# Windows: sync the vault with git on a timer

If you do not want **Go** for `obsidian-memoryd watch`, use a **scheduled task** that runs a PowerShell script in your vault (or equivalent).

## Requirements

- Vault with **`.git`** and `origin` remote (HTTPS or SSH with saved credentials).
- Recommended script: `scripts/windows/Sync-Memory.ps1` in the vault repo (`git add -A` → `commit` if needed → `pull --rebase` → `push`).

## No console flash (recommended)

Even with `-WindowStyle Hidden` on `powershell.exe`, a console window **may still flash**. The stable pattern is **`wscript.exe`** plus a tiny `.vbs` that starts PowerShell hidden (same idea as the legacy v1 vault shim).

Copy `Run-Hidden.vbs` next to your scripts (in this repo: `scripts/windows/Run-Hidden.vbs`; in the vault: `scripts/windows/Run-Hidden.vbs`).

## Create the task (every **60 minutes** by default, current user)

**Why 60 minutes:** a memory vault does not need tight `pull`/`push` loops; short intervals (5–10 min) add network/disk churn and can surface console flashes. For very active multi-machine setups, **15–30 minutes** is a reasonable middle ground; reserve **5 minutes** for debugging only.

Adjust `$vault` if your path differs. For a different cadence, change the number in **`-RepetitionInterval (New-TimeSpan -Minutes 60)`** and the task description.

```powershell
$vault = "$env:USERPROFILE\Documents\cursor-memory-vault"
$vbs = Join-Path $vault "scripts\windows\Run-Hidden.vbs"
$script = Join-Path $vault "scripts\windows\Sync-Memory.ps1"
$arg = "//nologo `"$vbs`" `"$script`""
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument $arg
$start = (Get-Date).AddMinutes(1)
$trigger = New-ScheduledTaskTrigger -Once -At $start `
  -RepetitionInterval (New-TimeSpan -Minutes 60) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Unregister-ScheduledTask -TaskName "CursorMemoryVaultSync" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "CursorMemoryVaultSync" -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description "Git sync cursor-memory-vault every 60 min (no window)"
```

### Run once manually

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Documents\cursor-memory-vault\scripts\windows\Sync-Memory.ps1"
```

### Inspect

```powershell
Get-ScheduledTask -TaskName "CursorMemoryVaultSync"
```

### Remove

```powershell
Unregister-ScheduledTask -TaskName "CursorMemoryVaultSync" -Confirm:$false
```

## Alternative: `obsidian-memoryd` (Go)

**On-save** debounced sync (**45 s** default; optional `OBSIDIAN_MEMORY_DEBOUNCE`, e.g. `90s` or `2m`): install Go, build from this repo (`go build -o obsidian-memoryd ./cmd/obsidian-memoryd`), run `obsidian-memoryd watch` with `BASIC_MEMORY_HOME` pointing at the vault. Windows service: `obsidian-memoryd service install` (see `cmd/obsidian-memoryd/main.go`).

## Español

Same walkthrough: [`windows-scheduled-vault-sync.md`](./windows-scheduled-vault-sync.md).

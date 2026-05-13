# Windows: sync the vault with git on a timer

If you do not want **Go** for `obsidian-memoryd watch`, use a **scheduled task** that runs a PowerShell script in your vault (or equivalent).

## Requirements

- Vault with **`.git`** and `origin` remote (HTTPS or SSH with saved credentials).
- Recommended script: `scripts/windows/Sync-Memory.ps1` in the vault repo (`git add -A` → `commit` if needed → `pull --rebase` → `push`).

## Create the task (every 10 minutes, current user)

Adjust `$vault` if your path differs.

```powershell
$vault = "$env:USERPROFILE\Documents\cursor-memory-vault"
$script = Join-Path $vault "scripts\windows\Sync-Memory.ps1"
$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
$start = (Get-Date).AddMinutes(1)
$trigger = New-ScheduledTaskTrigger -Once -At $start `
  -RepetitionInterval (New-TimeSpan -Minutes 10) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Unregister-ScheduledTask -TaskName "CursorMemoryVaultSync" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "CursorMemoryVaultSync" -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description "Git sync cursor-memory-vault every 10 min"
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

**On-save** debounced sync (~2 s): install Go, build from this repo (`go build -o obsidian-memoryd ./cmd/obsidian-memoryd`), run `obsidian-memoryd watch` with `BASIC_MEMORY_HOME` pointing at the vault. Windows service: `obsidian-memoryd service install` (see `cmd/obsidian-memoryd/main.go`).

## Español

Same walkthrough: [`windows-scheduled-vault-sync.md`](./windows-scheduled-vault-sync.md).

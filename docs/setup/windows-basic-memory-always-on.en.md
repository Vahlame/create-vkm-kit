# Windows: keep `basic-memory` MCP always running

Cursor can use **`basic-memory` over stdio** (Cursor spawns `uvx` when needed) or **Streamable HTTP** (a localhost process that stays up when you close and reopen Cursor).

This guide is the **persistent HTTP** option (“always on”).

## What gets installed on the machine

1. **uv** (for `uvx basic-memory`).
2. **`Start-BasicMemoryMcp.ps1`** (vault copy under `scripts/windows/`; canonical copy in this repo: `scripts/windows/Start-BasicMemoryMcp.ps1`).
3. Scheduled task **`CursorBasicMemoryHttpMcp` at logon**: runs the script hidden; if the process dies, Task Scheduler can **retry** (`RestartCount` / `RestartInterval`).
4. **`%USERPROFILE%\.cursor\mcp.json`**: `basic-memory` entry with `"url": "http://127.0.0.1:8765/mcp"` (no `command`/`uvx` for that server). The **port must match** the script default (**8765**) or your `-Port` override.

The server reads **`BASIC_MEMORY_HOME`** from the script (vault path). Cursor only uses HTTP; it does not need the vault path in `mcp.json` for `basic-memory`.

## No console window (scheduled tasks)

Do not use bare `powershell.exe` as the task action: a console **may flash**. Launch the `.ps1` with **`wscript.exe`** plus `Run-Hidden.vbs` (`scripts/windows/Run-Hidden.vbs` in this repo).

### Register `CursorBasicMemoryHttpMcp` (example)

```powershell
$vaultScripts = Join-Path $env:USERPROFILE "Documents\cursor-memory-vault\scripts\windows"
$vbs = Join-Path $vaultScripts "Run-Hidden.vbs"
$ps1 = Join-Path $vaultScripts "Start-BasicMemoryMcp.ps1"
$arg = "//nologo `"$vbs`" `"$ps1`""
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument $arg
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 15 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Unregister-ScheduledTask -TaskName "CursorBasicMemoryHttpMcp" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "CursorBasicMemoryHttpMcp" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "basic-memory MCP HTTP (no console flash)"
```

## Optional: `obsidian-memoryd watch` (Go, sync-on-save)

Besides **periodic git via scheduled task** (`CursorMemoryVaultSync`, **60 min** in the kit walkthrough), you can run **`obsidian-memoryd`** for debounced `git add/commit/pull/push` (**45 s** after the last change by default; tune with `OBSIDIAN_MEMORY_DEBOUNCE`) when vault files change.

### Install Go

For example: `winget install GoLang.Go`.

### Build the binary

From this repo clone:

```powershell
New-Item -ItemType Directory -Force -Path "$env:LOCALAPPDATA\cursor-memory\bin" | Out-Null
go build -ldflags="-H windowsgui" -o "$env:LOCALAPPDATA\cursor-memory\bin\obsidian-memoryd.exe" ./cmd/obsidian-memoryd
```

`-H windowsgui` prevents **obsidian-memoryd** from allocating its own console when started from Task Scheduler.

### Logon task

Task **`CursorObsidianMemorydWatch`** using **`wscript.exe //nologo Run-Hidden.vbs Start-ObsidianMemorydWatch.ps1`** (same pattern as HTTP `basic-memory`).

If you see **too many** auto-commits, disable either the **scheduled sync task** **or** `watch`, and keep one strategy (or raise the task interval / `OBSIDIAN_MEMORY_DEBOUNCE`).

## Ports and safety

The script defaults to **`127.0.0.1:8765`** (local only). **Why not 8000:** many dev stacks (APIs, other MCPs, internal tools) grab **8000**, **8080**, or **3000**; if something else is bound, Cursor may show `fetch failed` even when the TCP port “answers”. For **new apps** on the same machine, pick a high free port (e.g. **8765–8899**), use the **same** value in `Start-BasicMemoryMcp.ps1` (`-Port`) and `mcp.json` (`url`), and document it in the project runbook.

Do not expose the listener to the LAN without TLS and authentication.

## Verify

```powershell
Test-NetConnection 127.0.0.1 -Port 8765
```

In Cursor: **Settings → MCP** → `basic-memory` green. After editing `mcp.json`, **restart Cursor**.

## Remove / troubleshoot

- Stop listener: find PID with `Get-NetTCPConnection -LocalPort 8765`, then `Stop-Process` carefully.
- Remove task: `Unregister-ScheduledTask -TaskName CursorBasicMemoryHttpMcp -Confirm:$false`
- Back to stdio: restore `config/mcp/basic-memory.json` style entry and remove the HTTP task.

## JSON template

[`../../config/mcp/basic-memory-streamable-http.json`](../../config/mcp/basic-memory-streamable-http.json)

## Español

[`windows-basic-memory-always-on.md`](./windows-basic-memory-always-on.md).

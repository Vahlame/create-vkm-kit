# Windows: keep `basic-memory` MCP always running

Cursor can use **`basic-memory` over stdio** (Cursor spawns `uvx` when needed) or **Streamable HTTP** (a localhost process that stays up when you close and reopen Cursor).

This guide is the **persistent HTTP** option (“always on”).

## What gets installed on the machine

1. **uv** (for `uvx basic-memory`).
2. **`Start-BasicMemoryMcp.ps1`** (vault copy under `scripts/windows/`; canonical copy in this repo: `scripts/windows/Start-BasicMemoryMcp.ps1`).
3. Scheduled task **`CursorBasicMemoryHttpMcp` at logon**: runs the script hidden; if the process dies, Task Scheduler can **retry** (`RestartCount` / `RestartInterval`).
4. **`%USERPROFILE%\.cursor\mcp.json`**: `basic-memory` entry with `"url": "http://127.0.0.1:8000/mcp"` (no `command`/`uvx` for that server).

The server reads **`BASIC_MEMORY_HOME`** from the script (vault path). Cursor only uses HTTP; it does not need the vault path in `mcp.json` for `basic-memory`.

## Optional: `obsidian-memoryd watch` (Go, sync-on-save)

Besides **git every 10 minutes** (`CursorMemoryVaultSync`), you can run **`obsidian-memoryd`** for debounced `git add/commit/pull/push` when vault files change.

### Install Go

For example: `winget install GoLang.Go`.

### Build the binary

From this repo clone:

```powershell
New-Item -ItemType Directory -Force -Path "$env:LOCALAPPDATA\cursor-memory\bin" | Out-Null
go build -o "$env:LOCALAPPDATA\cursor-memory\bin\obsidian-memoryd.exe" ./cmd/obsidian-memoryd
```

### Logon task

Task **`CursorObsidianMemorydWatch`** runs `scripts\windows\Start-ObsidianMemorydWatch.ps1` in the vault (same pattern as HTTP MCP).

If you see **too many** auto-commits, disable either the 10-minute task **or** `watch`, and keep one strategy.

## Ports and safety

Default bind: **`127.0.0.1:8000`** (local only). Do not expose this port without TLS and authentication.

## Verify

```powershell
Test-NetConnection 127.0.0.1 -Port 8000
```

In Cursor: **Settings → MCP** → `basic-memory` green. After editing `mcp.json`, **restart Cursor**.

## Remove / troubleshoot

- Stop listener: find PID with `Get-NetTCPConnection -LocalPort 8000`, then `Stop-Process` carefully.
- Remove task: `Unregister-ScheduledTask -TaskName CursorBasicMemoryHttpMcp -Confirm:$false`
- Back to stdio: restore `config/mcp/basic-memory.json` style entry and remove the HTTP task.

## JSON template

[`../../config/mcp/basic-memory-streamable-http.json`](../../config/mcp/basic-memory-streamable-http.json)

## Español

[`windows-basic-memory-always-on.md`](./windows-basic-memory-always-on.md).

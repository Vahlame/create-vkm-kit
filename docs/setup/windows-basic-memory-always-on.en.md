# Windows: keep `basic-memory` available (no kit scripts)

Cursor can use **`basic-memory` over stdio** (recommended: Cursor spawns `uvx` when needed; see [`config/mcp/basic-memory.json`](../../config/mcp/basic-memory.json)) or **Streamable HTTP** (a localhost listener).

This guide does **not** ship `.ps1` or `.vbs` to copy. If you need persistent HTTP, use **commands** or a task you define yourself.

## Default: stdio

No separate process: keep `mcp.json` with `command` + `uvx` and `BASIC_MEMORY_HOME`. Avoids ports and scheduled tasks.

## Persistent HTTP (optional): terminal

In **Windows Terminal** or `cmd` (you can minimize):

```powershell
$env:BASIC_MEMORY_HOME = "C:\ABSOLUTE\PATH\TO\VAULT"
uvx basic-memory mcp --transport streamable-http --host 127.0.0.1 --port 8765 --path /mcp
```

The `basic-memory` entry in `mcp.json` should use the same URL, e.g. `"url": "http://127.0.0.1:8765/mcp"` (no `command`/`uvx` for that server).

**Port:** this kit defaults to **8765** to avoid clashes with **8000** / **8080** / **3000** on dev machines ([ADR-0016](../adr/0016-localhost-mcp-default-port.md)). If the port is taken, pick another free high port (e.g. **8877**) and use the **same** value in the `uvx` line and in `mcp.json`.

## HTTP via Task Scheduler (optional, advanced)

For logon start without a visible window, create the task yourself in `taskschd.msc`: program **`cmd.exe`**, arguments like `/c "set BASIC_MEMORY_HOME=C:\vault&& …\uvx.exe basic-memory mcp --transport streamable-http --host 127.0.0.1 --port 8765 --path /mcp"` (set the path to `uvx` via `where uvx`). This repo does not publish a ready-made file; validate quoting on your machine.

Do not expose the listener to the LAN without TLS and authentication.

## Optional: `obsidian-memoryd watch` (Go)

Vault file sync: [`windows-scheduled-vault-sync.en.md`](./windows-scheduled-vault-sync.en.md). Build with `-ldflags="-H windowsgui"` if you want no console window from the daemon itself.

## Verify

```powershell
Test-NetConnection 127.0.0.1 -Port 8765
```

In Cursor: **Settings → MCP** → `basic-memory` green. After `mcp.json` changes, **restart Cursor** or **Developer: Reload Window**.

## Remove / return to stdio

- Stop the listening process (Task Manager / `Get-NetTCPConnection`).
- Remove the task you created, if any.
- Restore the block from [`config/mcp/basic-memory.json`](../../config/mcp/basic-memory.json).

## HTTP JSON template

[`config/mcp/basic-memory-streamable-http.json`](../../config/mcp/basic-memory-streamable-http.json).

## Spanish

[`windows-basic-memory-always-on.md`](./windows-basic-memory-always-on.md).

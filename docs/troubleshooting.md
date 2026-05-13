# Troubleshooting

A standalone reference for errors and fixes summarized in the **v1** prompt (`docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md` section 11) and extended for **v2** MCP (`basic-memory`, bridges). Each entry is keyed by the exact error message when possible.

## Table of contents

- [PowerShell errors](#powershell-errors)
- [Git errors](#git-errors)
- [Scheduled task errors](#scheduled-task-errors)
- [MCP / Cursor errors](#mcp--cursor-errors)
- [Network and timing errors](#network-and-timing-errors)
- [How to recover from a broken install](#how-to-recover-from-a-broken-install)

## PowerShell errors

### `El token '&&' no es un separador de instrucciones valido en esta version`

- **Cause:** PowerShell 5.1 does not support `&&` and `||` as separators. Only PowerShell 7+ does.
- **Fix:** Chain with `;` and check `$?` or `$LASTEXITCODE` after each command.

```powershell
git add -A; if (-not $?) { throw "git add failed" }
git commit -m "x"; if ($LASTEXITCODE -ne 0) { throw "commit failed" }
```

### `ConvertFrom-Json: A parameter cannot be found that matches parameter name 'AsHashtable'`

- **Cause:** `-AsHashtable` exists only in PowerShell 7+. The setup script must work on 5.1.
- **Fix:** Use plain `ConvertFrom-Json` and `[pscustomobject]` at serialization time. See ADR-0005 for the canonical pattern.

### `The variable 'X' cannot be retrieved because it has not been set`

- **Cause:** `Set-StrictMode -Version Latest` is on and you tried to read a property that does not exist on a `[pscustomobject]`.
- **Fix:** Iterate via `$obj.PSObject.Properties` instead of dotted access, or initialize the property with a sentinel before reading.

### `the term 'pwsh' is not recognized`

- **Cause:** PowerShell 7 is not installed. The prompt's scripts target Windows PowerShell 5.1 (the `powershell.exe` already shipped with Windows). Some users see this when they copy the CI extractor script to a machine without PS7.
- **Fix:** For the install itself, you do not need pwsh. For local CI, `winget install --id Microsoft.PowerShell`.

## Git errors

### `cannot pull with rebase: You have unstaged changes`

- **Cause:** `Sync-Memory.ps1` was invoked in the wrong order and called `pull --rebase` before staging local edits.
- **Fix:** The canonical order is `add -A` -> `commit` -> `pull --rebase` -> `push`. See ADR-0004.

### `Author identity unknown`

- **Cause:** No `git config --global user.name` or `user.email`.
- **Fix:**

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Run before any commit. The Preflight check in section 6.1 catches this and prompts.

### `git ls-remote <url>` hangs prompting for credentials

- **Cause:** No Git Credential Manager. Modern Git for Windows installers bundle GCM by default but older or custom installs can skip it.
- **Fix:** Reinstall Git for Windows with the GCM option enabled, or run `gh auth login` which configures GCM for you.

### `Repository not found` from `ls-remote`

- **Cause:** The repo URL is wrong, the repo does not exist, or your account lacks access.
- **Fix:** Go back to section 0 of the prompt, recreate or reinvite. Verify the URL by visiting it in a browser while signed in.

### `error: failed to push some refs to ...` after a successful `pull --rebase`

- **Cause:** Two machines pushed at almost the same time.
- **Fix:** The next sync (10 minutes later) will retry. To force immediate convergence: run `Sync-Memory.ps1` manually twice.

## Scheduled task errors

### `ERROR: The system cannot find the file specified` after `schtasks /Create`

- **Cause:** Quoting issue when the path to the VBS runner contains spaces.
- **Fix:** Wrap the `/TR` argument in double quotes and invoke through `cmd /c` so PowerShell does not re-parse the inner quoting. The prompt's `Enable-MCP-Watchdog.ps1` and `Enable-AutoSync.ps1` already do this.

### A console window appears every 5 or 10 minutes

- **Cause:** The task was created to run `powershell.exe` directly. PowerShell flashes a window on cold launch even with `-WindowStyle Hidden`.
- **Fix:** Rebuild the task to run `wscript.exe //B //nologo <runner>.vbs`. The VBS shim hides the window. See ADR-0003.

### `Doctor.ps1` says the task exists but `Ultimo resultado` is non-zero

- **Cause:** The last invocation of the task threw. Inspect the script the task points at:
  - `Ensure-ObsidianMCP.ps1`: usually a transient network failure on `npx`. The watchdog will retry next cycle.
  - `Sync-Memory.ps1`: usually a Git credential problem or a merge conflict.
- **Fix:** Run the underlying script manually with the same parameters and read the error.

## MCP / Cursor errors

### `uv` / `uvx` is not recognized (Windows)

- **Cause:** `basic-memory` is started with `uvx basic-memory mcp`, but **uv** is not installed or not on `PATH`.
- **Fix:** Install uv (adds `~/.local/bin` to your user `PATH`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
```

Close and reopen the terminal (or Cursor) so `uvx` resolves. Verify with `uv --version`.

### `create-obsidian-memory` prints `Invalid JSON in mcp.json` even though the file looks fine

- **Cause:** Some editors (or `Set-Content -Encoding utf8` in older PowerShell) write a **UTF-8 BOM** at the start of `mcp.json`. `JSON.parse` rejects that leading byte unless it is stripped.
- **Fix:** As of `@vahlame/create-obsidian-memory` **2.0.0-beta.2**, the initializer strips a leading BOM before merging. Re-run non-interactive merge, or remove the BOM manually (re-save as UTF-8 without BOM, or delete the first invisible character).

### Cursor MCP panel: `obsidian-memory` red / "no disponible"

- **Cause (most common):** `mcp.json` points Cursor at the SSE endpoint directly.
- **Fix:** Use `mcp-remote` as the command (see ADR-0001 and prompt section 6.4).
- **Cause (less common):** The MCP server is not running.
- **Fix:** `powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Documents\cursor-memory-vault\scripts\windows\Ensure-ObsidianMCP.ps1"`. Then refresh the MCP list in Cursor.

### `mcp.json` lost my Linear / Supabase entries

- **Cause:** A previous setup run overwrote the file instead of merging.
- **Fix:** Restore from `mcp.json.bak`. The current setup script always backs up first and merges, but older versions may have clobbered the file.

### Cursor log: `Transient error connecting to streamableHttp server: fetch failed`

- **Cause:** `mcp.json` uses a **`url`** (Streamable HTTP) for `basic-memory` but **nothing valid is listening** on that host/port: scheduled task not started yet, server crashed, **or another unrelated program already bound the port** (so TCP “succeeds” but MCP `fetch` still fails).
- **Fix:** Start the HTTP MCP server (Windows: `Start-ScheduledTask -TaskName CursorBasicMemoryHttpMcp` or run `Start-BasicMemoryMcp.ps1` in the vault). Verify the listener is actually **basic-memory** (for example `netstat -ano | findstr :8765` then check the PID’s command line / process name). If the default port is taken by something else, pick a free high port (e.g. **8877**) and set the **same** value in both `Start-BasicMemoryMcp.ps1` (`-Port`) and `mcp.json` (`"url": "http://127.0.0.1:8877/mcp"`). If you do not need a persistent listener, switch back to **stdio** (`command` + `uvx`) via `config/mcp/basic-memory.json`. See `docs/setup/windows-basic-memory-always-on.md`.
- **Note (`ECONNREFUSED` right after editing `mcp.json`):** Cursor may reconnect **before** the logon task finishes the first cold `uvx` start (can be **20–40 s**). Wait, or run `Start-ScheduledTask -TaskName CursorBasicMemoryHttpMcp` once, then **Developer: Reload Window**.

### Toast: `Failed to open resource: memory://...`

- **Cause:** Cursor tried to open **native / virtual “memory”** content (`memory://` scheme), not a file in your Markdown vault. The link may be stale or the resource no longer exists.
- **Fix:** Close the notification; **Developer: Reload Window** if it keeps appearing. For vault notes, use MCP tools (`read_note`, `write_note`, …). This is **not** caused by git autosync or `Run-Hidden.vbs`.

### Cursor: `basic-memory` rojo con URL `http://127.0.0.1:…/mcp`

- **Cause:** El servidor HTTP de `basic-memory` no está levantado, o el **puerto está ocupado por otra app** (TCP puede “abrir” pero MCP falla con `fetch failed`).
- **Fix:** `Start-ScheduledTask -TaskName CursorBasicMemoryHttpMcp` o `Start-BasicMemoryMcp.ps1` del vault. Comprueba con `netstat -ano | findstr :8765` que el PID corresponde a `basic-memory`/`uv`. Si el puerto por defecto está tomado, elige otro (p. ej. **8877**) igual en el script (`-Port`) y en `mcp.json`. Guía: `docs/setup/windows-basic-memory-always-on.md`.

### Parpadea una consola grande al sincronizar o al arrancar el MCP

- **Cause:** La tarea programada llama **`powershell.exe`** directamente o el binario es una app de **consola** (por defecto `go build` sin flags).
- **Fix:** Usa **`wscript.exe //nologo ...\Run-Hidden.vbs ...\TuScript.ps1`** como acción de la tarea (`scripts/windows/Run-Hidden.vbs` en el repo). Para **`obsidian-memoryd`**, recompila con `go build -ldflags="-H windowsgui" -o ...\obsidian-memoryd.exe` (ver `docs/setup/windows-basic-memory-always-on.md`).

### Muchas ventanas de CMD / consola negra al abrir Cursor o al refrescar MCP

- **Causa (frecuente):** Cursor arranca procesos MCP definidos con **`command`** (p. ej. **`node`** para `obsidian-memory-hybrid`, o **`uvx`** / **`npx`**) en cada conexión o **reintento**; en Windows eso puede mostrar **consola** aunque tus tareas del vault estén bien. Comprueba tareas: `Get-ScheduledTask -TaskName CursorBasicMemoryHttpMcp,CursorMemoryVaultSync | % { $_.Actions }` — si ves **`wscript.exe`** + **`Run-Hidden.vbs`**, el sync y el HTTP del vault **no** son la causa de esos flashes.
- **Causa (HTTP `basic-memory`):** Tras `config_server_modified` o reinicio, Cursor puede intentar **antes** de que el listener exista → `ECONNREFUSED` en el log; los reintentos encadenan más arranques de otros MCP con consola.
- **Qué hacer:** Tras encender el PC o cambiar `mcp.json`: `Start-ScheduledTask -TaskName CursorBasicMemoryHttpMcp`, espera **20–40 s** (primera vez `uvx` descarga), luego **Developer: Reload Window**. Para **menos ventanas**, desactiva temporalmente MCP que no uses (p. ej. `obsidian-memory-hybrid`) o usa **`basic-memory` por stdio** (`config/mcp/basic-memory.json`) si no necesitas el servidor HTTP fijo.
- **Diagnóstico (repo):** Con el problema en curso, ejecuta [`tools/monitor-console-live.ps1`](../tools/monitor-console-live.ps1) (muestreo 1s; imprime padre y `CommandLine` truncado de `powershell` / `conhost` / `cmd` / `wscript`). Parámetros: `-Iterations`, `-IntervalSeconds`, `-CommandLineMax`.

### Cada pocos segundos aparece `conhost` y el padre es `git` (Windows)

- **Prevención (kit):** Este repo y el ejemplo de vault incluyen **`.vscode/settings.json`** con `git.autorefresh` / `git.autofetch` desactivados y exclusiones de **watcher** (incluye `.obsidian/`). Cursor/VS Code aplican esos valores al abrir la carpeta como workspace. El inicializador **`@vahlame/create-obsidian-memory`** crea el mismo archivo en el vault **solo si no existía** (no pisa tus ajustes).
- **Causa:** Algo (casi siempre el **control de código fuente del IDE** o una extensión tipo **GitLens**) lanza **`git.exe`** en bucle (`status`, diffs, etc.). En Windows muchas invocaciones crean **`conhost.exe`** como hijo de **`git`**. Si en la línea *baseline* del script ves **decenas** de `conhost` (p. ej. 50+), suele haber **muchas ventanas del IDE**, **muchos roots abiertos**, o procesos que no se cierran bien.
- **Qué hacer:** Abre el repo/vault como **carpeta raíz** para que cargue `.vscode/settings.json`. Si ya tienes `settings.json` propio, copia las claves `git.*` y `files.watcherExclude` desde [`examples/.vscode/settings.json`](../examples/.vscode/settings.json). Revisa extensiones Git pesadas y **cierra** ventanas duplicadas del mismo repo.
- **Confirmación:** En el log del script, líneas `+ conhost ... parent=... (git)` cada ~2–5 s mientras el fallo ocurre.

### `npx -y mcp-remote` is very slow the first time

- **Cause:** Empty `npx` cache. Cold install takes ~30 seconds.
- **Fix:** Wait once. Subsequent calls are near-instant.

## Network and timing errors

### Health endpoint `http://127.0.0.1:3001/health` does not respond immediately after starting the server

- **Cause:** The MCP server can take 6 to 15 seconds to bind the port.
- **Fix:** `Ensure-ObsidianMCP.ps1` already retries for ~30 seconds. If you call the endpoint manually, wait and retry.

### Port `3001` is already in use

- **Cause:** Another process bound the port.
- **Fix:** Change the port everywhere consistently: `Ensure-ObsidianMCP.ps1 -Port 3002`, `mcp.json` args `http://127.0.0.1:3002/sse`, and re-create the watchdog task with `-Port 3002`. Inspect with `Get-NetTCPConnection -LocalPort 3001`.

## How to recover from a broken install

If something is wrong and you want to start fresh without touching your vault content, the safe path is:

1. **Diagnose connectivity:** `powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Documents\cursor-memory-vault\scripts\windows\Doctor.ps1"`. Note every `[FAIL]` and `[WARN]`.
2. **Diagnose vault content:** same path but `Vault-Doctor.ps1` (add `-WriteReview` if you want a markdown report file in the vault). `[WARN]` is common on legacy vaults (for example missing frontmatter); fix any `[FAIL]` before treating the install as healthy.
3. **Repair targeted pieces only**, in this order:
   - `Ensure-ObsidianMCP.ps1` if health is failing.
   - `Enable-MCP-Watchdog.ps1` if the watchdog task is missing.
   - `Enable-AutoSync.ps1` if the autosync task is missing.
4. **Full rerun:** re-paste the prompt into a new Cursor chat with the same `<REPO_URL_PRIVADO>`. The setup is idempotent: existing vault, scripts, and tasks are preserved or backed up.
5. **Nuke and restart (last resort):** delete the two scheduled tasks (`schtasks /Delete /TN CursorObsidianMcpWatchdog /F` and the autosync), restore `mcp.json` from `.bak`, and re-paste the prompt.

The vault directory itself (`%USERPROFILE%\Documents\cursor-memory-vault`) is never touched destructively, so your memory survives any of the above.

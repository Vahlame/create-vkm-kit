# Troubleshooting

Standalone reference for **v2** (`basic-memory`, optional hybrid, Streamable HTTP). Historical **v1** errors (SSE `:3001`, `Ensure-ObsidianMCP.ps1`, etc.) appear only in [`docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md`](./legacy/PROMPT_ULTRA_COMPLETO_v1.md); do not use those flows for new installs.

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

- **Cause:** Something ran `git pull --rebase` while the working tree still had **unstaged** changes. The safe order is `git add -A` → commit (only if needed) → `pull --rebase` → `push` ([ADR-0004](./adr/0004-sync-order-add-commit-pull-push.md)). A manual `git pull --rebase` or automation skipped the add/commit steps.
- **Fix:** The canonical order is `add -A` -> `commit` -> `pull --rebase` -> `push`. See ADR-0004 and [`windows-scheduled-vault-sync.md`](./setup/windows-scheduled-vault-sync.md).

### `Author identity unknown`

- **Cause:** No `git config --global user.name` or `user.email`.
- **Fix:**

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Run before any first commit in a new vault or machine.

### `git ls-remote <url>` hangs prompting for credentials

- **Cause:** No Git Credential Manager. Modern Git for Windows installers bundle GCM by default but older or custom installs can skip it.
- **Fix:** Reinstall Git for Windows with the GCM option enabled, or run `gh auth login` which configures GCM for you.

### `Repository not found` from `ls-remote`

- **Cause:** The repo URL is wrong, the repo does not exist, or your account lacks access.
- **Fix:** Verify the URL in the browser while signed in; fix `origin` with `git remote -v` / `git remote set-url` if needed.

### `error: failed to push some refs to ...` after a successful `pull --rebase`

- **Cause:** Two machines pushed at almost the same time.
- **Fix:** If you use Task Scheduler for git, wait for the next run or sync manually (`git pull` / `git push` from a terminal). See [`windows-scheduled-vault-sync.md`](./setup/windows-scheduled-vault-sync.md). Otherwise run `git pull` / `git push` from the integrated terminal.

## Scheduled task errors

### `ERROR: The system cannot find the file specified` after `schtasks /Create`

- **Cause:** Quoting issue in the `/TR` argument, or the program path in the task does not exist.
- **Fix:** Wrap the `/TR` argument in double quotes and invoke through `cmd /c` so PowerShell does not re-parse the inner quoting. Revisa la línea de comando en **Programador de tareas** → tarea → **Acciones**. Las guías actuales del kit **no** publican plantillas `schtasks` listas para copiar.

### A console window appears every few minutes (scheduled task cadence)

- **Cause:** The task runs **`powershell.exe`** or **`cmd.exe`** in a way that shows a window on each run.
- **Fix:** Edit the task in `taskschd.msc` (different program, “run whether user is logged on or not” vs interactive trade-offs, or disable the task). Prefer **stdio** `basic-memory` and **manual git** or **`obsidian-memoryd watch`** instead of custom scheduled shells. If the task still runs too often, increase the interval.

### Scheduled task shows non-zero last result

- **Cause:** The task action failed (Git credentials, merge conflict, wrong path, or HTTP MCP not up yet).
- **Fix:** Open **Task Scheduler** → task → **History** / run the command line shown under **Actions** manually in a terminal. For git sync options see [`windows-scheduled-vault-sync.md`](./setup/windows-scheduled-vault-sync.md). For HTTP `basic-memory` see [`windows-basic-memory-always-on.md`](./setup/windows-basic-memory-always-on.md).

## MCP / Cursor errors

### `uv` / `uvx` is not recognized (Windows)

- **Cause:** `basic-memory` is started with `uvx basic-memory mcp`, but **uv** is not installed or not on `PATH`.
- **Fix:** Install uv from the official docs: [uv installation](https://docs.astral.sh/uv/getting-started/installation/).

Close and reopen the terminal (or Cursor) so `uvx` resolves. Verify with `uv --version`.

### `create-obsidian-memory` prints `Invalid JSON in mcp.json` even though the file looks fine

- **Cause:** Some editors (or `Set-Content -Encoding utf8` in older PowerShell) write a **UTF-8 BOM** at the start of `mcp.json`. `JSON.parse` rejects that leading byte unless it is stripped.
- **Fix:** As of `@vahlame/create-obsidian-memory` **2.0.0-beta.2**, the initializer strips a leading BOM before merging. Re-run non-interactive merge, or remove the BOM manually (re-save as UTF-8 without BOM, or delete the first invisible character).

### Cursor MCP panel: `basic-memory` red / "not available"

- **Cause (common):** **`uv` / `uvx` missing** from `PATH` in the environment Cursor uses, or first cold `uvx` download still running (**20–40 s**).
- **Fix:** Install uv, restart Cursor, wait once. See [`uv` / `uvx` is not recognized](#uv--uvx-is-not-recognized-windows) above.
- **Cause:** **`BASIC_MEMORY_HOME`** points at a folder that does not exist or is not readable.
- **Fix:** Set an **absolute** path to your vault root in `mcp.json`. Re-run `npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "<path>"` to merge a known-good entry.
- **Cause:** You use **`url`** (Streamable HTTP) but nothing listens on that port.
- **Fix:** Start the listener (see [`windows-basic-memory-always-on.md`](./setup/windows-basic-memory-always-on.md)) **or** switch to **stdio** (`command` + `uvx`) via [`config/mcp/basic-memory.json`](../config/mcp/basic-memory.json).

### `mcp.json` lost my Linear / Supabase entries

- **Cause:** A previous setup run overwrote the file instead of merging.
- **Fix:** Restore from `mcp.json.bak`. The current setup script always backs up first and merges, but older versions may have clobbered the file.

### Cursor log: `Transient error connecting to streamableHttp server: fetch failed`

- **Cause:** `mcp.json` uses a **`url`** (Streamable HTTP) for `basic-memory` but **nothing valid is listening** on that host/port: listener not started yet, server crashed, **or another unrelated program already bound the port** (so TCP “succeeds” but MCP `fetch` still fails).
- **Fix:** Start the HTTP listener the way you configured it (see [`windows-basic-memory-always-on.md`](./setup/windows-basic-memory-always-on.md)) — for example a **minimized terminal** with `uvx basic-memory mcp --transport streamable-http …`, or run your scheduled task once if you created one. Verify the listener is actually **basic-memory** (for example `netstat -ano | findstr :8765` then check the PID’s command line / process name). If the default port is taken by something else, pick a free high port (e.g. **8877**) and set the **same** value in the **listener command** and in `mcp.json` (`"url": "http://127.0.0.1:8877/mcp"`). If you do not need a persistent listener, switch back to **stdio** (`command` + `uvx`) via [`config/mcp/basic-memory.json`](../config/mcp/basic-memory.json).
- **Note (`ECONNREFUSED` right after editing `mcp.json`):** Cursor may reconnect **before** the first cold `uvx` start finishes (can be **20–40 s**). Wait, start the listener, then **Developer: Reload Window**.

### Toast: `Failed to open resource: memory://...`

- **Cause:** Cursor tried to open **native / virtual “memory”** content (`memory://` scheme), not a file in your Markdown vault. The link may be stale or the resource no longer exists.
- **Fix:** Close the notification; **Developer: Reload Window** if it keeps appearing. For vault notes, use MCP tools (`read_note`, `write_note`, …). This is **not** caused by git autosync alone.

### Cursor: `basic-memory` rojo con URL `http://127.0.0.1:…/mcp`

- **Cause:** El servidor HTTP de `basic-memory` no está levantado, o el **puerto está ocupado por otra app** (TCP puede “abrir” pero MCP falla con `fetch failed`).
- **Fix:** Arranca el listener HTTP como en [`windows-basic-memory-always-on.md`](./setup/windows-basic-memory-always-on.md) (terminal minimizada o tarea que **tú** definiste). Comprueba con `netstat -ano | findstr :8765` que el PID corresponde a `basic-memory`/`uv`. Si el puerto por defecto está tomado, elige otro (p. ej. **8877**) **igual** en la línea de arranque y en `mcp.json`.

### Parpadea una consola grande al sincronizar o al arrancar el MCP

- **Cause:** La tarea programada llama **`powershell.exe`** directamente o el binario es una app de **consola** (por defecto `go build` sin flags).
- **Fix:** Edita la tarea en `taskschd.msc` o usa un binario **GUI-subsystem** para el daemon: **`obsidian-memoryd`** con `go build -ldflags="-H windowsgui"` (ver [`windows-basic-memory-always-on.md`](./setup/windows-basic-memory-always-on.md)).

### Muchas ventanas de CMD / consola negra al abrir Cursor o al refrescar MCP

- **Causa (frecuente):** Cursor arranca procesos MCP definidos con **`command`** (p. ej. **`node`** para `obsidian-memory-hybrid`, o **`uvx`** / **`npx`**) en cada conexión o **reintento**; en Windows eso puede mostrar **consola**.
- **Causa (HTTP `basic-memory`):** Tras `config_server_modified` o reinicio, Cursor puede intentar **antes** de que el listener exista → `ECONNREFUSED` en el log; los reintentos encadenan más arranques de otros MCP con consola.
- **Qué hacer:** Arranca el listener HTTP y espera **20–40 s** (primera vez `uvx` descarga), luego **Developer: Reload Window**. Para **menos ventanas**, desactiva MCP que no uses o usa **`basic-memory` por stdio** ([`config/mcp/basic-memory.json`](../config/mcp/basic-memory.json)).
- **Diagnóstico:** **Administrador de tareas** → **Detalles** (columna línea de comando) o **Monitor de recursos** mientras ocurre el problema. Guía: [`windows-sin-consola-visible.md`](./setup/windows-sin-consola-visible.md).

### Cada pocos segundos aparece `conhost` y el padre es `git` (Windows)

- **Prevención (kit):** Este repo y el ejemplo de vault incluyen **`.vscode/settings.json`** con `git.autorefresh` / `git.autofetch` desactivados y exclusiones de **watcher** (incluye `.obsidian/`). Cursor/VS Code aplican esos valores al abrir la carpeta como workspace. El inicializador **`@vahlame/create-obsidian-memory`** **crea o fusiona** `<vault>/.vscode/settings.json` al pasar `--vault` (las claves del kit para Git/SCM se actualizan; se conservan otras claves tuyas).
- **Causa:** Algo (casi siempre el **control de código fuente del IDE** o una extensión tipo **GitLens**) lanza **`git.exe`** en bucle (`status`, diffs, etc.). En Windows muchas invocaciones crean **`conhost.exe`** como hijo de **`git`**. Si ves **decenas** de `conhost`, suele haber **muchas ventanas del IDE**, **muchos roots abiertos**, o procesos que no se cierran bien.
- **Qué hacer:** Abre el repo/vault como **carpeta raíz** para que cargue `.vscode/settings.json`. Si ya tienes `settings.json` propio, copia las claves `git.*` y `files.watcherExclude` desde [`examples/.vscode/settings.json`](../examples/.vscode/settings.json). Revisa extensiones Git pesadas y **cierra** ventanas duplicadas del mismo repo.
- **Guía completa (Windows):** [`docs/setup/windows-sin-consola-visible.md`](./setup/windows-sin-consola-visible.md).

### Ventana emergente con título `git.exe` o `…\\Git\\bin\\sh.exe` (roba foco)

- **Causa:** Algo (Cursor SCM, extensión o tarea) está lanzando **`…\\Git\\bin\\git.exe`** o **`bin\\sh.exe`** en **consola aparte**. Eso es típico de Git for Windows cuando no se usa el **`cmd\\git.exe`** pensado para programas con interfaz.
- **Arreglo:** En **Settings → JSON** (usuario o workspace) pon **`"git.path": "C:\\\\Program Files\\\\Git\\\\cmd\\\\git.exe"`** (ajusta la ruta si tu Git es portable u otro disco: `where.exe git` en PowerShell) y **`"git.terminalAuthentication": false`**. El kit **fusiona** ambas cosas al correr `create-obsidian-memory` con `--vault` en Windows si encuentra `cmd\\git.exe`. Luego **Developer: Reload Window**.
- **Código 0 o 1** en el mensaje de “proceso terminado” es secundario; el problema es la **ventana** que quita el foco del juego o del editor.

### `npx -y mcp-remote` is very slow the first time

- **Cause:** Empty `npx` cache. Cold install takes ~30 seconds.
- **Fix:** Wait once. Subsequent calls are near-instant.

## Network and timing errors

### Legacy v1 only: `http://127.0.0.1:3001/health` (archived SSE stack)

If you still maintain an **archived** smith-and-web / `:3001` setup from v1, see [`docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md`](./legacy/PROMPT_ULTRA_COMPLETO_v1.md). **v2** does not use `:3001` by default; use MCP Inspector / client logs for `basic-memory` instead.

## How to recover from a broken install (v2)

1. **MCP config:** Back up `%USERPROFILE%\.cursor\mcp.json`, then re-merge with  
   `npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "<absolute-vault-path>"`  
   (restores a known-good `basic-memory` entry; see [`GETTING_STARTED.md`](../GETTING_STARTED.md)).
2. **Workspace Git noise (Windows):** Ensure the vault is opened as a **folder** so `vault/.vscode/settings.json` applies; re-run the same command to merge kit keys.
3. **Manual checks:** [`docs/testing/manual-checks.md`](./testing/manual-checks.md) §2 (MCP smoke).
4. **Optional Windows tasks / HTTP listener:** Follow [`windows-basic-memory-always-on.md`](./setup/windows-basic-memory-always-on.md) and [`windows-scheduled-vault-sync.md`](./setup/windows-scheduled-vault-sync.md) only if you chose those options — they are not required for stdio `basic-memory`.
5. **Reset local duro (Windows):** haz copia de seguridad de `%USERPROFILE%\.cursor\mcp.json`, borra o desactiva en `taskschd.msc` las tareas `Cursor*` que ya no quieras, y vuelve a fusionar MCP con el comando del paso 1. No borres el vault salvo que tú lo decidas.

Your Markdown files stay in **git**; nothing in this section deletes vault content unless you explicitly remove folders or run a destructive script you chose yourself.

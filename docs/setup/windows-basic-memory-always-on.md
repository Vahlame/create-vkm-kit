# Windows: mantener `basic-memory` MCP siempre encendido

Cursor puede usar **`basic-memory` por stdio** (Cursor lanza `uvx` al abrir el chat) o por **Streamable HTTP** (un proceso escuchando en localhost que sigue vivo aunque cierres y abras Cursor).

Esta guía describe la opción **HTTP persistente** (recomendada si quieres “siempre arriba”).

## Qué se instala en el PC

1. **uv** (ya lo usas para `uvx basic-memory`).
2. Script **`Start-BasicMemoryMcp.ps1`** (en el vault: `scripts/windows/`, copia canónica en este repo: `scripts/windows/Start-BasicMemoryMcp.ps1`).
3. Tarea programada **`CursorBasicMemoryHttpMcp`** al **inicio de sesión**: ejecuta el script en segundo plano; si el proceso muere, el Programador puede **reintentar** (configuración `RestartCount` / `RestartInterval`).
4. **`%USERPROFILE%\.cursor\mcp.json`**: entrada `basic-memory` con `"url": "http://127.0.0.1:8765/mcp"` (sin `command`/`uvx` para ese servidor). El **puerto debe coincidir** con el del script (por defecto **8765**).

El servidor usa **`BASIC_MEMORY_HOME`** dentro del script (ruta del vault). Cursor solo habla HTTP; no necesita repetir el path del vault en `mcp.json` para `basic-memory`.

## Sin ventana de consola (tareas programadas)

No uses `powershell.exe` solo como acción de la tarea: a veces **parpadea** una consola. Lanza el `.ps1` con **`wscript.exe`** + `Run-Hidden.vbs` (en `scripts/windows/Run-Hidden.vbs`).

### Registrar `CursorBasicMemoryHttpMcp` (ejemplo)

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
Register-ScheduledTask -TaskName "CursorBasicMemoryHttpMcp" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "basic-memory MCP HTTP (sin ventana)"
```

## Opcional: `obsidian-memoryd watch` (Go, sincro al guardar)

Además del **git periódico por tarea** (`CursorMemoryVaultSync`, **60 min** en la guía del kit), puedes tener **`obsidian-memoryd`** haciendo `git add/commit/pull/push` con **debounce** (por defecto **45 s** tras el último cambio; `OBSIDIAN_MEMORY_DEBOUNCE` para afinar) cuando cambian archivos del vault.

### Instalar Go

Por ejemplo: `winget install GoLang.Go`.

### Compilar el binario

Desde el clon de este repo:

```powershell
New-Item -ItemType Directory -Force -Path "$env:LOCALAPPDATA\cursor-memory\bin" | Out-Null
go build -ldflags="-H windowsgui" -o "$env:LOCALAPPDATA\cursor-memory\bin\obsidian-memoryd.exe" ./cmd/obsidian-memoryd
```

`-H windowsgui` evita que **obsidian-memoryd** abra consola propia al arrancar desde el Programador de tareas.

### Tarea al inicio de sesión

Tarea **`CursorObsidianMemorydWatch`** con **`wscript.exe //nologo Run-Hidden.vbs Start-ObsidianMemorydWatch.ps1`** (mismo patrón que `basic-memory` HTTP).

Si notas **demasiados** commits automáticos, desactiva la **tarea programada de sync** **o** el `watch`, y deja solo una estrategia (o sube el intervalo de la tarea / el valor de `OBSIDIAN_MEMORY_DEBOUNCE`).

## Puertos y seguridad

Por defecto el script usa **`127.0.0.1:8765`** (solo esta máquina). **Por qué no 8000:** muchas apps de desarrollo (APIs, otros MCP, herramientas internas) suelen ocupar **8000**, **8080** o **3000**; si otra cosa escucha ahí, Cursor puede mostrar `fetch failed` aunque “el puerto responda”. Para **nuevas apps** en la misma máquina, elige un puerto alto libre (p. ej. **8765–8899**), úsalo **igual** en `Start-BasicMemoryMcp.ps1` (`-Port`) y en `mcp.json` (`url`), y documenta el valor en el runbook del proyecto.

No expongas el listener a la red sin TLS y autenticación.

## Comprobar

```powershell
Test-NetConnection 127.0.0.1 -Port 8765
```

En Cursor: **Settings → MCP** → `basic-memory` en verde. Si cambiaste `mcp.json`, **reinicia Cursor**.

## Quitar / depurar

- Detener proceso: `Get-NetTCPConnection -LocalPort 8765` → `Stop-Process -Id …` con cuidado.
- Quitar tarea: `Unregister-ScheduledTask -TaskName CursorBasicMemoryHttpMcp -Confirm:$false`
- Volver a stdio: restaura en `mcp.json` el bloque de `config/mcp/basic-memory.json` y quita la tarea HTTP.

## Plantilla JSON

Ver [`../../config/mcp/basic-memory-streamable-http.json`](../../config/mcp/basic-memory-streamable-http.json).

## English

[`windows-basic-memory-always-on.en.md`](./windows-basic-memory-always-on.en.md).

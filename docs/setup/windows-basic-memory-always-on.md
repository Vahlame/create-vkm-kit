# Windows: mantener `basic-memory` MCP siempre encendido

Cursor puede usar **`basic-memory` por stdio** (Cursor lanza `uvx` al abrir el chat) o por **Streamable HTTP** (un proceso escuchando en localhost que sigue vivo aunque cierres y abras Cursor).

Esta guía describe la opción **HTTP persistente** (recomendada si quieres “siempre arriba”).

## Qué se instala en el PC

1. **uv** (ya lo usas para `uvx basic-memory`).
2. Script **`Start-BasicMemoryMcp.ps1`** (en el vault: `scripts/windows/`, copia canónica en este repo: `scripts/windows/Start-BasicMemoryMcp.ps1`).
3. Tarea programada **`CursorBasicMemoryHttpMcp`** al **inicio de sesión**: ejecuta el script en segundo plano; si el proceso muere, el Programador puede **reintentar** (configuración `RestartCount` / `RestartInterval`).
4. **`%USERPROFILE%\.cursor\mcp.json`**: entrada `basic-memory` con `"url": "http://127.0.0.1:8000/mcp"` (sin `command`/`uvx` para ese servidor).

El servidor usa **`BASIC_MEMORY_HOME`** dentro del script (ruta del vault). Cursor solo habla HTTP; no necesita repetir el path del vault en `mcp.json` para `basic-memory`.

## Opcional: `obsidian-memoryd watch` (Go, sincro al guardar)

Además del **git cada 10 minutos** (`CursorMemoryVaultSync`), puedes tener **`obsidian-memoryd`** haciendo `git add/commit/pull/push` con **debounce** cuando cambian archivos del vault.

### Instalar Go

Por ejemplo: `winget install GoLang.Go`.

### Compilar el binario

Desde el clon de este repo:

```powershell
New-Item -ItemType Directory -Force -Path "$env:LOCALAPPDATA\cursor-memory\bin" | Out-Null
go build -o "$env:LOCALAPPDATA\cursor-memory\bin\obsidian-memoryd.exe" ./cmd/obsidian-memoryd
```

### Tarea al inicio de sesión

Tarea **`CursorObsidianMemorydWatch`** ejecutando `scripts\windows\Start-ObsidianMemorydWatch.ps1` del vault (mismo patrón que el MCP HTTP).

Si notas **demasiados** commits automáticos, desactiva la tarea de 10 min **o** el `watch`, y deja solo una estrategia.

## Puertos y seguridad

Por defecto escucha en **`127.0.0.1:8000`** (solo esta máquina). No expongas ese puerto a la red sin TLS y auth.

## Comprobar

```powershell
Test-NetConnection 127.0.0.1 -Port 8000
```

En Cursor: **Settings → MCP** → `basic-memory` en verde. Si cambiaste `mcp.json`, **reinicia Cursor**.

## Quitar / depurar

- Detener proceso: `Get-NetTCPConnection -LocalPort 8000` → `Stop-Process -Id …` con cuidado.
- Quitar tarea: `Unregister-ScheduledTask -TaskName CursorBasicMemoryHttpMcp -Confirm:$false`
- Volver a stdio: restaura en `mcp.json` el bloque de `config/mcp/basic-memory.json` y quita la tarea HTTP.

## Plantilla JSON

Ver [`../../config/mcp/basic-memory-streamable-http.json`](../../config/mcp/basic-memory-streamable-http.json).

## English

[`windows-basic-memory-always-on.en.md`](./windows-basic-memory-always-on.en.md).

# Windows: `basic-memory` siempre disponible (sin scripts del kit)

Cursor puede usar **`basic-memory` por stdio** (recomendado: Cursor arranca `uvx` cuando hace falta; ver [`config/mcp/basic-memory.json`](../../config/mcp/basic-memory.json)) o **Streamable HTTP** (un proceso que escucha en localhost).

Esta guía **no** incluye `.ps1` ni `.vbs` para copiar. Si necesitas HTTP persistente, hazlo con **comandos** o con una tarea que tú definas.

## Por defecto: stdio

No hace falta proceso aparte: deja `mcp.json` con `command` + `uvx` y `BASIC_MEMORY_HOME`. Cierra el tema de puertos y tareas.

## HTTP persistente (opcional): terminal

En **Windows Terminal** o `cmd` (puedes minimizar la ventana):

```powershell
$env:BASIC_MEMORY_HOME = "C:\RUTA\ABSOLUTA\AL\VAULT"
uvx basic-memory mcp --transport streamable-http --host 127.0.0.1 --port 8765 --path /mcp
```

En `mcp.json`, la entrada `basic-memory` debe usar la misma URL, p. ej. `"url": "http://127.0.0.1:8765/mcp"` (sin `command`/`uvx` para ese servidor).

**Puerto:** el kit documenta **8765** por defecto para evitar choques con **8000** / **8080** / **3000** en máquinas de desarrollo ([ADR-0016](../adr/0016-localhost-mcp-default-port.md)). Si el puerto está ocupado por otra app, elige otro libre (p. ej. **8877**) y usa **el mismo** en la línea `uvx` y en `mcp.json`.

## HTTP vía Programador de tareas (opcional, avanzado)

Si quieres arranque al inicio de sesión **sin** depender de una ventana, crea tú la tarea en `taskschd.msc`: programa **`cmd.exe`**, argumentos del estilo `/c "set BASIC_MEMORY_HOME=C:\vault&& …\uvx.exe basic-memory mcp --transport streamable-http --host 127.0.0.1 --port 8765 --path /mcp"` (ajusta la ruta a `uvx` con `where uvx`). Este repo no publica esa línea como archivo listo para copiar; valida comillas y permisos en tu máquina.

No expongas el listener a la red sin TLS y autenticación.

## Opcional: `obsidian-memoryd watch` (Go, git al guardar)

Complemento para el vault en disco: [`windows-scheduled-vault-sync.md`](./windows-scheduled-vault-sync.md). Compila el `.exe` con `-ldflags="-H windowsgui"` si no quieres consola del propio daemon.

## Comprobar

```powershell
Test-NetConnection 127.0.0.1 -Port 8765
```

En Cursor: **Settings → MCP** → `basic-memory` en verde. Tras cambiar `mcp.json`, **reinicia Cursor** o **Developer: Reload Window**.

## Quitar / volver a stdio

- Detén el proceso que escucha el puerto (`Get-NetTCPConnection` / Administrador de tareas).
- Quita la tarea que creaste, si aplica.
- Restaura en `mcp.json` el bloque de [`config/mcp/basic-memory.json`](../../config/mcp/basic-memory.json).

## Plantilla JSON HTTP

[`config/mcp/basic-memory-streamable-http.json`](../../config/mcp/basic-memory-streamable-http.json).

## English

[`windows-basic-memory-always-on.en.md`](./windows-basic-memory-always-on.en.md).

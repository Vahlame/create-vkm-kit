# Cursor + Obsidian Memory (Cross-Device)

Guia simple y detallada para tener memoria persistente de largo plazo en Cursor usando Obsidian y GitHub.

## Que vas a lograr

- Memoria compartida entre dispositivos.
- Sincronizacion automatica con GitHub.
- Recuperacion automatica del MCP de Obsidian si se cae.
- Instalacion rapida en equipos nuevos.

## Idea principal

Los LLM no tienen memoria infinita nativa.  
La solucion es externalizar la memoria en Markdown:

- `MEMORY.md` -> conocimiento estable/global.
- `SESSION_LOG.md` -> bitacora de sesiones.
- `PROJECTS/*.md` -> memoria por proyecto.

## Arquitectura

1. Cursor usa `mcp-remote`.
2. `mcp-remote` se conecta a `http://127.0.0.1:3001/sse`.
3. Un servidor Obsidian MCP lee/escribe el vault.
4. Git sincroniza el vault con GitHub.
5. Task Scheduler:
   - auto-sync cada 10 min
   - watchdog MCP cada 5 min

## Requisitos

- Windows 10/11
- Git
- Node.js + npm
- Cursor
- Obsidian (opcional, pero recomendado para navegar notas)

## Estructura recomendada del vault

```text
cursor-memory-vault/
  MEMORY.md
  SESSION_LOG.md
  PROJECTS/
    TEMPLATE.md
  SNIPPETS/
  cursor-install/
    install-cursor-memory.ps1
    bootstrap-from-github.ps1
    sync-memory.ps1
    enable-auto-sync.ps1
    ensure-obsidian-mcp.ps1
    enable-obsidian-mcp-watchdog.ps1
```

## Configuracion de Cursor MCP

Archivo: `%USERPROFILE%\.cursor\mcp.json`

```json
{
  "mcpServers": {
    "obsidian-memory": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://127.0.0.1:3001/sse"
      ]
    }
  }
}
```

## Flujo de instalacion (resumen)

1. Crear repo privado para el vault.
2. Subir vault base.
3. Ejecutar bootstrap en cada equipo nuevo.
4. Reiniciar Cursor.
5. Agregar regla de memoria en User Rules.

## Regla recomendada para Cursor User Rules

Usa la version en `examples/CURSOR_USER_RULE_MEMORY.md`.

## Verificacion rapida

En Cursor:

1. "Usa `obsidian-memory` y lee `MEMORY.md`."
2. "Agrega una linea de prueba en `SESSION_LOG.md`."

En consola:

```powershell
powershell -NoProfile -Command "(Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing).StatusCode"
```

Debe devolver `200`.

## Troubleshooting

### Error: MCP no disponible

- Verifica `mcp.json`.
- Verifica que responda `http://127.0.0.1:3001/health`.
- Revisa tarea `CursorObsidianMcpWatchdog`.
- Reinicia Cursor.

### Se abre ventana CMD cada 10 min

- Ejecuta tareas con `wscript //B //nologo` + `.vbs`.
- Evita ejecutar `powershell.exe` directo en la tarea.

### Sync falla

- Verifica permisos de repo.
- Corre manual:

```powershell
powershell -ExecutionPolicy Bypass -File "$HOME\Documents\cursor-memory-vault\cursor-install\sync-memory.ps1"
```

## Seguridad

- Usa repo privado para la memoria real.
- No guardes secretos.
- Si expones un token, revocalo y crea uno nuevo.

## Licencia

MIT

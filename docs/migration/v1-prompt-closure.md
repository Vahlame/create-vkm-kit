# Cierre v1 → v2 (lo que el primer ultra-prompt prometía)

El archivo `docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md` era un **brief operativo único** para Windows (Task Scheduler, `mcp-remote`, SSE `:3001`, scripts embebidos). En **v2** el mismo objetivo se cumple con piezas distintas y repo **público** como kit de herramientas.

## Tabla de equivalencias (checklist mental)

| Objetivo v1 (sección ~6 / 12) | v2 (este repo)                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Repo privado del vault + git  | Igual; tú sigues siendo dueño del remoto                                                                   |
| MCP conectado en Cursor       | `basic-memory` vía `uvx` + `BASIC_MEMORY_HOME` (ver `config/mcp/basic-memory.json`)                        |
| Watchdog + autosync (tareas)  | Opcional: `obsidian-memoryd watch` (Go) o tu propio timer / systemd                                        |
| `Doctor.ps1` / health `:3001` | Inspector MCP + `docs/testing/manual-checks.md` (transporte ya no es SSE fijo en v2)                       |
| `Vault-Doctor.ps1`            | Sigue siendo válido si mantienes scripts en el **vault** privado; no viven en este repo público (ADR-0006) |
| User Rules sección 9          | Reglas sincronizadas desde `AGENTS.md` / `.cursor/rules/` (ver `npm run sync-agents`)                      |
| Búsqueda “tipo RAG” a escala  | Opcional: `obsidian-memory-rag` (FTS5 local, ADR-0014)                                                     |

## Qué ya no aplica tal cual en v2

- **`mcp-remote` obligatorio** para el servidor por defecto: v2 usa **`uvx basic-memory mcp`** (stdio / HTTP según cliente). `mcp-remote` queda como **puente legado** si aún montas un SSE remoto; pinéalo ( `docs/security/mcp-remote-rce.md` ).
- **Tareas `schtasks` + wscript**: patrón v1 Windows; en Linux/macOS usa el daemon o systemd (ver `cmd/obsidian-memoryd`).

## Orden recomendado hoy

1. Leer `README.md` / `README.en.md` y `AGENTS.md`.
2. Ejecutar `npx @vahlame/create-obsidian-memory@next` (o copiar el snippet MCP del README).
3. Validar con `docs/testing/manual-checks.md`.
4. (Opcional) `obsidian-memory-rag index --vault <ruta>` si el vault es grande.

Para mapeo herramienta a herramienta MCP: `docs/migration/v1-to-v2-mcp.md`.

# Cierre v1 → v2 (lo que el primer ultra-prompt prometía)

El antiguo prompt v1 era un **brief operativo único** para Windows (Task Scheduler, `mcp-remote`, SSE `:3001`, scripts embebidos). En **v2** el mismo objetivo se cumple con piezas distintas y repo **público** como kit de herramientas.

## Tabla de equivalencias (checklist mental)

| Objetivo v1 (sección ~6 / 12) | v2 (este repo)                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo privado del vault + git  | Igual; tú sigues siendo dueño del remoto                                                                                                                                                |
| MCP conectado en Cursor       | `basic-memory` vía `uvx` + `BASIC_MEMORY_HOME` (ver `config/mcp/basic-memory.json`)                                                                                                     |
| Watchdog + autosync (tareas)  | Opcional: `obsidian-memoryd watch` (Go), git manual, o automatismo **tuyo**; capítulo **v2 → v3** (sin scripts del kit): [`v2-to-v3-script-free-kit.md`](./v2-to-v3-script-free-kit.md) |
| `Doctor.ps1` / health `:3001` | Inspector MCP + `docs/testing/manual-checks.md` (transporte ya no es SSE fijo en v2)                                                                                                    |
| `Vault-Doctor.ps1`            | Sigue siendo válido si mantienes scripts en el **vault** privado; no viven en este repo público (ADR-0006)                                                                              |
| User Rules sección 9          | Bloque listo para Cursor: **`docs/cursor-memory-setup.md`**; además `AGENTS.md` + reglas sincronizadas para quien **desarrolla este repo** (`npm run sync-agents`)                      |
| Búsqueda “tipo RAG” a escala  | Opcional: `obsidian-memory-rag` (FTS5 local, ADR-0014)                                                                                                                                  |

## Qué ya no aplica tal cual en v2

- **`mcp-remote` obligatorio** para el servidor por defecto: v2 usa **`uvx basic-memory mcp`** (stdio / HTTP según cliente). `mcp-remote` queda como **puente legado** si aún montas un SSE remoto; pinéalo ( `docs/security/mcp-remote-rce.md` ).
- **Tareas `schtasks` (histórico v1 Windows):** patrón descrito en ADR-0003; en Linux/macOS usa el daemon o systemd (ver `cmd/obsidian-memoryd`).

## Orden recomendado hoy

1. [`docs/es/instalacion.md`](../es/instalacion.md) (flujo lineal) y [`docs/es/como-funciona.md`](../es/como-funciona.md) (idea general).
2. `README.md` y `AGENTS.md`.
3. Ejecutar `npx @vahlame/create-obsidian-memory@next` (o copiar el snippet MCP del README).
4. Validar con `docs/testing/manual-checks.md`.
5. (Opcional) `obsidian-memory-rag index --vault <ruta>` si el vault es grande.

Para mapeo herramienta a herramienta MCP: `docs/migration/v1-to-v2-mcp.md`. **Siguiente capítulo (mismo repo, `main`):** integración avanzada **sin** scripts del kit → [`v2-to-v3-script-free-kit.md`](./v2-to-v3-script-free-kit.md).

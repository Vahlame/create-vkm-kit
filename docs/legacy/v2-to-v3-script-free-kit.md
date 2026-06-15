# Migración v2 → v3: kit público sin scripts ejecutables (integración avanzada)

Todo lo de este capítulo vive en **`main`**: no hay rama separada para “v3”.

## Qué significa “v3”

**v3** nombra el **modelo de envío del kit** a partir de esta línea base:

- El repositorio **ya no incluye** plantillas **PowerShell** ni **`.vbs`** bajo `scripts/windows/` ni scripts de conveniencia bajo `tools/*.ps1` para la integración del usuario final en Windows.
- La integración **avanzada** que la guía ya perseguía (MCP estable, git al vault, FTS opcional, HTTP opcional) se hace con **`uvx`**, el **daemon Go** `obsidian-memoryd`, **plantillas JSON** (`config/mcp/*.json`), el **inicializador** npm y **procedimiento documentado** — sin acoplar la historia a ficheros `.ps1` copiables desde este repo.

**v3 no cambia el protocolo de memoria** (Markdown + MCP + git en tu vault). Cambia **qué artefactos** promete y copia el kit público.

## Relación con otros capítulos

| Capítulo                                                      | Dónde                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| v1 → v2 (ultra-prompt → `basic-memory`, kit público)          | [`v1-prompt-closure.md`](./v1-prompt-closure.md), [`v1-to-v2-mcp.md`](./v1-to-v2-mcp.md) |
| **v2 → v3 (sin scripts del kit, misma integración avanzada)** | **este documento**                                                                       |

## Tabla de sustitución (si dependías de ficheros del repo)

| Antes (v2, ficheros en el kit)                           | v3 (equivalente documentado)                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/windows/Start-BasicMemoryMcp.ps1`               | Comando `uvx basic-memory mcp --transport streamable-http …` en **terminal** o **tarea** que definas tú; [`../es/sincronizacion.md`](../es/sincronizacion.md) |
| `scripts/windows/Run-Hidden.vbs` + `.ps1`                | No publicado por el kit: minimiza la terminal, usa `obsidian-memoryd` compilado con `-ldflags="-H windowsgui"`, o crea **tu** launcher                        |
| `scripts/windows/Get-CursorScheduledTaskConsoleRisk.ps1` | **Programador de tareas** (GUI) + **Administrador de tareas** / **Monitor de recursos**                                                                       |
| `tools/monitor-console-live.ps1`                         | Mismo enfoque **manual** (procesos + línea de comando)                                                                                                        |
| `tools/windows-reset-agent-memory.ps1`                   | Pasos manuales en [`../es/troubleshooting.md`](../es/troubleshooting.md) (respaldo `mcp.json`, tareas `Cursor*`, re-ejecutar initializer)                     |
| `tools/purge-memory-mcp-cache.ps1`                       | Limpieza manual de cachés bajo `.cursor/projects/…` si aplica (ver troubleshooting / foros del IDE)                                                           |

## Camino de integración avanzada **sin** scripts del kit (orden recomendado)

1. **Vault y git** — `npx @vahlame/create-obsidian-memory`, plantilla [`../../examples/`](../../examples/).
2. **MCP por defecto** — **stdio** [`../../config/mcp/basic-memory.json`](../../config/mcp/basic-memory.json) + `BASIC_MEMORY_HOME`.
3. **Reglas del agente** — [`../es/instalacion.md`](../es/instalacion.md) (User Rules) + [`../../AGENTS.md`](../../AGENTS.md) para quien trabaja en el repo.
4. **Sincronización git del vault** — [`../../cmd/obsidian-memoryd`](../../cmd/obsidian-memoryd) (`watch`) o **git manual**; [`../es/sincronizacion.md`](../es/sincronizacion.md).
5. **Vaults grandes** — `obsidian-memory-rag` + MCP híbrido. Camino rápido: `node packages/create-obsidian-memory/src/index.js --non-interactive --vault "<ruta>" --with-hybrid --repo-root "<clon-del-kit>"` (necesita `pip install -e packages/obsidian-memory-rag` previo). Manual: [`../../config/mcp/obsidian-memory-hybrid.json`](../../config/mcp/obsidian-memory-hybrid.json); [`../es/instalacion.md`](../es/instalacion.md) (Verificación).
6. **HTTP persistente (opcional)** — misma guía always-on: **no** hace falta ningún `.ps1` del repositorio.
7. **CI / calidad del repo** — sin cambio para mantenedores: TypeScript (`scripts/sync-agents.ts`).

## Historia y ADRs

- El **razonamiento histórico** del shim VBS (ADR-0003) sigue en [`../adr/0003-scheduled-tasks-via-wscript.md`](../adr/0003-scheduled-tasks-via-wscript.md); la cabecera aclara que la **guía pública** ya no publica esa plantilla.
- El **orden git** sigue en [ADR-0004](../adr/0004-sync-order-add-commit-pull-push.md).

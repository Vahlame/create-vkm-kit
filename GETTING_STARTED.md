# Primer uso: flujo lineal (kit v3)

> **¿Quieres que el agente haga la instalación por ti?** Pega [`INSTALAR_MEMORIA.md`](./INSTALAR_MEMORIA.md) en un chat nuevo de Cursor. El agente ejecutará todos los pasos automáticamente.
>
> Esta guía es para quien prefiere entender cada paso antes de ejecutarlo.

Lee **en orden**. Cada paso enlaza al siguiente. No saltes pasos salvo que el texto diga “opcional”.

| Paso | Qué haces                                                                                         | Dónde se explica                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Entender la idea (sin instalar nada)                                                              | [`docs/how-memory-works-simple.md`](./docs/how-memory-works-simple.md)                                                                                                                                                                                                                                                                                                                          |
| 1    | Tener una carpeta-vault con Markdown (y git)                                                      | Mismo doc, sección “El vault”; ejemplo en [`examples/`](./examples/)                                                                                                                                                                                                                                                                                                                            |
| 2    | Instalar **Node 20+** y **uv**                                                                    | [§ Requisitos en `docs/cursor-memory-setup.md`](./docs/cursor-memory-setup.md#requisitos-en-tu-pc)                                                                                                                                                                                                                                                                                              |
| 3    | Conectar el IDE al vault con **MCP** (`basic-memory`)                                             | Plantilla [`config/mcp/basic-memory.json`](./config/mcp/basic-memory.json) y [§ Paso 1 en guía Cursor](./docs/cursor-memory-setup.md#paso-1-configurar-mcp-en-cursor)                                                                                                                                                                                                                           |
| 4    | (Solo Cursor) Pegar **User Rules**                                                                | [§ Paso 3 en guía Cursor](./docs/cursor-memory-setup.md#paso-3-user-rules-pegar-en-cursor)                                                                                                                                                                                                                                                                                                      |
| 5    | Comprobar que las herramientas MCP responden                                                      | [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md) §2                                                                                                                                                                                                                                                                                                                           |
| 6    | (Opcional) Índice FTS + MCP híbrido para bóvedas grandes                                          | `create-obsidian-memory … --with-hybrid` (desde clon del kit) + `pip install -e packages/obsidian-memory-rag`; o plantilla manual [`config/mcp/obsidian-memory-hybrid.json`](./config/mcp/obsidian-memory-hybrid.json); checks en [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md) §6–7                                                                                                                                                                                                                                  |
| 7    | (Opcional) Sincronizar el vault con git (`obsidian-memoryd`, git manual, o tareas que definas tú) | [`cmd/obsidian-memoryd`](./cmd/obsidian-memoryd/), [`docs/setup/windows-scheduled-vault-sync.md`](./docs/setup/windows-scheduled-vault-sync.md), **MCP HTTP opcional:** [`docs/setup/windows-basic-memory-always-on.md`](./docs/setup/windows-basic-memory-always-on.md). Tras montarlo en Windows: [`docs/testing/windows-memory-sync-smoke.md`](./docs/testing/windows-memory-sync-smoke.md). |
| 8    | (Alternativa) Memoria **dentro del mismo repo git** sin automatismos locales extra                | [`docs/setup/memory-repo-sin-automatismos-locales.md`](./docs/setup/memory-repo-sin-automatismos-locales.md) — actualización solo con `git pull`/`git push`.                                                                                                                                                                                                                                    |

**Rutas de `mcp.json` según sistema operativo:**

| SO | Ruta |
|----|------|
| Windows | `%USERPROFILE%\.cursor\mcp.json` |
| Linux | `~/.config/Cursor/User/globalStorage/cursor.mcp/mcp.json` |
| macOS | `~/Library/Application Support/Cursor/User/globalStorage/cursor.mcp/mcp.json` |

Abre el vault como **carpeta de workspace** para que Cursor/VS Code apliquen **`/.vscode/settings.json`** (menos sondeo Git en Windows). El comando `create-obsidian-memory` de arriba **crea o fusiona** ese archivo en el vault (las claves del kit para Git/SCM y watcher se aplican siempre; el resto de tus claves se conservan). Plantilla de referencia: [`examples/.vscode/settings.json`](./examples/.vscode/settings.json). Detalle: [`docs/troubleshooting.md`](./docs/troubleshooting.md) y [`docs/setup/windows-sin-consola-visible.md`](./docs/setup/windows-sin-consola-visible.md).

## Primera instalación vs. actualización

**Primera instalación:** sigue la tabla de arriba en orden (pasos 0–5 como mínimo).

**Actualización tras `git pull` del kit:** re-ejecuta el comando de fusión (`create-obsidian-memory`) para recoger nuevas claves en `mcp.json` y `.vscode/settings.json`; no hace falta reinstalar `uv` ni Node si ya funcionaban. Compara las User Rules con las de `docs/cursor-memory-setup.md` y actualiza si hay cambios.

## Atajo si ya tienes vault y repo clonado

```bash
# Solo basic-memory (publicado en npm)
npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "/ruta/absoluta/al/vault"

# basic-memory + obsidian-memory-hybrid (desde clon del kit; instala antes: pip install -e packages/obsidian-memory-rag)
node packages/create-obsidian-memory/dist/index.js --non-interactive --vault "/ruta/absoluta/al/vault" --with-hybrid --repo-root "/ruta/absoluta/al/cursor-obsidian-memory-guide"
```

Eso **mezcla** `basic-memory` en el `mcp.json` de Cursor (Windows: `%USERPROFILE%\.cursor\mcp.json`), y **crea o fusiona** `vault/.vscode/settings.json` (menos ruido Git en Windows). Luego haz el **paso 4** (User Rules) y el **paso 5** (verificación).

## Si trabajas en este repositorio (código / PRs)

1. [`AGENTS.md`](./AGENTS.md)
2. [`CONTRIBUTING.md`](./CONTRIBUTING.md)

## English

Same linear path: [`GETTING_STARTED.en.md`](./GETTING_STARTED.en.md).

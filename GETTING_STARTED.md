# Primer uso: flujo lineal (v2)

Lee **en orden**. Cada paso enlaza al siguiente. No saltes pasos salvo que el texto diga “opcional”.

| Paso | Qué haces                                                         | Dónde se explica                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Entender la idea (sin instalar nada)                              | [`docs/how-memory-works-simple.md`](./docs/how-memory-works-simple.md)                                                                                                                                                                                                                                                                                                                                                     |
| 1    | Tener una carpeta-vault con Markdown (y git)                      | Mismo doc, sección “El vault”; ejemplo en [`examples/`](./examples/)                                                                                                                                                                                                                                                                                                                                                       |
| 2    | Instalar **Node 20+** y **uv**                                    | [§ Requisitos en `docs/cursor-memory-setup.md`](./docs/cursor-memory-setup.md#requisitos-en-tu-pc)                                                                                                                                                                                                                                                                                                                         |
| 3    | Conectar el IDE al vault con **MCP** (`basic-memory`)             | Plantilla [`config/mcp/basic-memory.json`](./config/mcp/basic-memory.json) y [§ Paso 1 en guía Cursor](./docs/cursor-memory-setup.md#paso-1-configurar-mcp-en-cursor)                                                                                                                                                                                                                                                      |
| 4    | (Solo Cursor) Pegar **User Rules**                                | [§ Paso 3 en guía Cursor](./docs/cursor-memory-setup.md#paso-3-user-rules-pegar-en-cursor)                                                                                                                                                                                                                                                                                                                                 |
| 5    | Comprobar que las herramientas MCP responden                      | [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md) §2                                                                                                                                                                                                                                                                                                                                                      |
| 6    | (Opcional) Índice FTS + MCP híbrido para bóvedas grandes          | [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md) §6–7 y [`config/mcp/obsidian-memory-hybrid.json`](./config/mcp/obsidian-memory-hybrid.json)                                                                                                                                                                                                                                                             |
| 7    | (Opcional) Sincronizar el vault con git (al guardar o cada X min) | Daemon Go [`cmd/obsidian-memoryd/`](./cmd/obsidian-memoryd/), tarea Windows: [`docs/setup/windows-scheduled-vault-sync.md`](./docs/setup/windows-scheduled-vault-sync.md), **MCP siempre arriba:** [`docs/setup/windows-basic-memory-always-on.md`](./docs/setup/windows-basic-memory-always-on.md). Tras montarlo en Windows: [`docs/testing/windows-memory-sync-smoke.md`](./docs/testing/windows-memory-sync-smoke.md). |

Abre el vault como **carpeta de workspace** para que Cursor/VS Code apliquen **`/.vscode/settings.json`** (menos sondeo Git en Windows). El comando `create-obsidian-memory` de arriba **crea** ese archivo en el vault si aún no existe; plantilla en [`examples/.vscode/settings.json`](./examples/.vscode/settings.json). Si el archivo ya existía de antes, **fusiona** las claves nuevas o borra el archivo y vuelve a ejecutar el comando. Detalle: [`docs/troubleshooting.md`](./docs/troubleshooting.md) y guía [`docs/setup/windows-sin-consola-visible.md`](./docs/setup/windows-sin-consola-visible.md).

## Atajo si ya tienes vault y repo clonado

```bash
npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "/ruta/absoluta/al/vault"
```

Eso **mezcla** `basic-memory` en el `mcp.json` de Cursor (Windows: `%USERPROFILE%\.cursor\mcp.json`), y **crea** `vault/.vscode/settings.json` si no existía (menos ruido Git en Windows). Luego haz el **paso 4** (User Rules) y el **paso 5** (verificación).

## Si trabajas en este repositorio (código / PRs)

1. [`AGENTS.md`](./AGENTS.md)
2. [`CONTRIBUTING.md`](./CONTRIBUTING.md)

## English

Same linear path: [`GETTING_STARTED.en.md`](./GETTING_STARTED.en.md).

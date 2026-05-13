# Primer uso: flujo lineal (v2)

Lee **en orden**. Cada paso enlaza al siguiente. No saltes pasos salvo que el texto diga “opcional”.

| Paso | Qué haces                                                         | Dónde se explica                                                                                                                                                                                                                                                                                    |
| ---- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Entender la idea (sin instalar nada)                              | [`docs/how-memory-works-simple.md`](./docs/how-memory-works-simple.md)                                                                                                                                                                                                                              |
| 1    | Tener una carpeta-vault con Markdown (y git)                      | Mismo doc, sección “El vault”; ejemplo en [`examples/`](./examples/)                                                                                                                                                                                                                                |
| 2    | Instalar **Node 20+** y **uv**                                    | [§ Requisitos en `docs/cursor-memory-setup.md`](./docs/cursor-memory-setup.md#requisitos-en-tu-pc)                                                                                                                                                                                                  |
| 3    | Conectar el IDE al vault con **MCP** (`basic-memory`)             | Plantilla [`config/mcp/basic-memory.json`](./config/mcp/basic-memory.json) y [§ Paso 1 en guía Cursor](./docs/cursor-memory-setup.md#paso-1-configurar-mcp-en-cursor)                                                                                                                               |
| 4    | (Solo Cursor) Pegar **User Rules**                                | [§ Paso 3 en guía Cursor](./docs/cursor-memory-setup.md#paso-3-user-rules-pegar-en-cursor)                                                                                                                                                                                                          |
| 5    | Comprobar que las herramientas MCP responden                      | [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md) §2                                                                                                                                                                                                                               |
| 6    | (Opcional) Índice FTS + MCP híbrido para bóvedas grandes          | [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md) §6–7 y [`config/mcp/obsidian-memory-hybrid.json`](./config/mcp/obsidian-memory-hybrid.json)                                                                                                                                      |
| 7    | (Opcional) Sincronizar el vault con git (al guardar o cada X min) | Daemon Go [`cmd/obsidian-memoryd/`](./cmd/obsidian-memoryd/), tarea Windows: [`docs/setup/windows-scheduled-vault-sync.md`](./docs/setup/windows-scheduled-vault-sync.md), **MCP siempre arriba:** [`docs/setup/windows-basic-memory-always-on.md`](./docs/setup/windows-basic-memory-always-on.md) |

## Atajo si ya tienes vault y repo clonado

```bash
npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "/ruta/absoluta/al/vault"
```

Eso **mezcla** `basic-memory` en el `mcp.json` de Cursor (Windows: `%USERPROFILE%\.cursor\mcp.json`). Luego haz el **paso 4** (User Rules) y el **paso 5** (verificación).

## Si vienes de la versión antigua (v1 Windows)

Sigue el **paso 0** y luego [`docs/migration/v1-prompt-closure.md`](./docs/migration/v1-prompt-closure.md) (tabla “equivalencias”).

## Si trabajas en este repositorio (código / PRs)

1. [`AGENTS.md`](./AGENTS.md)
2. [`CONTRIBUTING.md`](./CONTRIBUTING.md)

## English

Same linear path: [`GETTING_STARTED.en.md`](./GETTING_STARTED.en.md).

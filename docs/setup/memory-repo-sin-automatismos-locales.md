# Memoria del agente dentro de un solo repo git: sin automatismos locales extra

**Objetivo:** tener la **memoria de agente** (Markdown + MCP `basic-memory`) en un **repositorio git** que ya actualizas con tu flujo normal — **sin** segundo temporizador ni instaladores de mantenimiento en tu PC.

## Idea central

1. Usa un **clon git privado** que contenga tanto tu fork/estructura como el árbol de notas del agente (o un repo dedicado solo a memoria).
2. En Cursor, pon `BASIC_MEMORY_HOME` en un path **dentro de ese clon** (absoluto), p. ej. `D:\trabajo\mi-setup\memory` o la raíz del repo si ahí viven las notas.
3. **“Auto-actualizable”** aquí significa: un solo **`git pull` / `git push`** mantiene alineados **código + docs + memoria versionada**. No hace falta un segundo canal (temporizador, daemon) cuyo único trabajo sea “refrescar memoria”.

## Qué actualiza qué

| Objetivo                                     | Cómo (sin automatismos locales)                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Plantillas y docs del **kit público** arriba | `git pull` del upstream en tu fork/clon; merge/rebase como siempre.                     |
| **Tus** notas (`MEMORY.md`, `PROJECTS/`, …)  | Mismo repo: commit + push al cerrar; en otro equipo, `git pull`.                        |
| Texto **AGENTS** de _este_ repo público      | Mantenedores: `npm run sync-agents` en CI/PRs (metadatos del kit, no tu vault privado). |

## Layout sugerido (privado)

En un **repo privado** (no subas secretos a GitHub público):

```text
mi-memoria-agente/
  memory/                 # BASIC_MEMORY_HOME = esta carpeta
    .obsidian/              # opcional (Obsidian); basic-memory no lo exige
    START_HERE.md
    MEMORY.md
    SESSION_LOG.md
    PROJECTS/
  README.md                 # cómo abrir en Cursor
```

- `mcp.json` de Cursor: `uvx basic-memory mcp` con `BASIC_MEMORY_HOME` = ruta absoluta a `.../mi-memoria-agente/memory`.
- Abre **`mi-memoria-agente`** (o `memory` como raíz del workspace) para que aplique el `.vscode` de ese nivel.

## Límites honestos

- No hay “auto-sync en segundo plano” sin **ningún** actor: o **tú** haces `git pull`, o añades **CI en la nube** (GitHub Actions en _tu_ repo). Eso no es el Programador de tareas en tu PC, pero sí automatización en servidor. Este doc asume **solo git en tu máquina**.
- El MCP HTTP “siempre encendido” (`8765`) implica un proceso persistente; ver [`windows-basic-memory-always-on.md`](./windows-basic-memory-always-on.md) — otro compromiso.

## Relación con el resto del kit

- El camino “vault aparte en `Documents` + tareas Windows” sigue en [`windows-scheduled-vault-sync.md`](./windows-scheduled-vault-sync.md) para quien quiera sync por reloj.
- Este patrón es la alternativa **mínima**: un árbol git, MCP stdio, cero tareas programadas.

## English

Same walkthrough: [`memory-repo-sin-automatismos-locales.en.md`](./memory-repo-sin-automatismos-locales.en.md).

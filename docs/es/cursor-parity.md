# Handoff de paridad con Cursor

Verificado el 2026-08-03 contra las Agent Skills y Hooks de Cursor (create-skill /
create-hook). Esta nota mantiene alineadas las superficies Claude Code ↔ Cursor.

## Skills

- Ruta instalada: `$HOME/.cursor/skills/{vkm-discipline,vkm-spec,…}/` (las ocho skills).
- Fuente: `packages/create-vkm-kit/templates/skills/`.
- Ruta canónica Cursor-only: `~/.cursor/skills`. (Si Cursor también carga
  `~/.claude/skills/` es **no verificado** — no depender del cross-load; instalar con
  `--ide cursor` para poblar el home de Cursor.)
- **No** hay plantilla `vkm-implementer` para Cursor: los Task/subagent types de Cursor
  son otro formato (queda documentado como deuda, no como bug).
- Multi-ventana: `cursor-session-state.json` es un solo archivo global bajo `~/.vkm/` —
  dos ventanas Cursor simultáneas comparten los contadores del stop-nudge.

## Reglas

- Globales: `$HOME/.cursor/rules/obsidian-memory.mdc` (`alwaysApply: true`).
- Proyecto (opcional): `<cwd>/.cursor/rules/obsidian-memory.mdc` cuando el cwd ≠ home.
- El panel **Settings → Rules → User Rules** de Cursor sigue siendo manual (el IDE lo
  guarda fuera de disco); el `.mdc` global cubre el protocolo de memoria en cada chat.

## Hooks

- Config: `$HOME/.cursor/hooks.json` (`version: 1`).
- Scripts: `$HOME/.cursor/hooks/`, hashes en `$HOME/.cursor/vkm-kit.assets.json`.
- Mapeo:
  - `sessionStart` → contexto del vault (`cursor-session-start.mjs`)
  - `afterFileEdit` + `afterMCPExecution` → contadores de sesión (stop nudge)
  - `stop` → recordatorio de cierre (`followup_message`)
  - `afterMCPExecution` → token-saver MCP (`updated_mcp_tool_output`)
- **No portado (honesto):**
  - guard de auto-memoria nativa de Claude y effort-advisor (`/effort`)
  - compactación de salida Bash/shell (Cursor no tiene `afterBash`; solo se compacta MCP JSON)

## Drift / seguimiento

- El payload exacto de `afterMCPExecution` varía por versión de Cursor; el compactador
  prueba varias claves (`tool_response`, `result`, `output`, …) y falla abierto.
- `stop` usa `followup_message` (no el `decision:block` de Claude). Si Cursor cambia el
  contrato, el hook debe degradar a no-op, nunca colgar el stop.

## Checks

```bash
npm test --workspace @vkmikc/create-vkm-kit
```

# Handoff de paridad con Codex CLI

Verificado el 2026-07-27 contra el manual oficial vigente de Codex. Esta nota permite que
una sesión futura de Claude Code mantenga alineadas las superficies de Claude y Codex.

## Skills

- Ruta instalada: `$HOME/.agents/skills/{vkm-discipline,vkm-spec,vkm-design,vkm-research}/`.
- Fuente: `packages/create-vkm-kit/templates/skills/`; el instalador copia todos los archivos
  de cada directorio y conserva cada `SKILL.md` byte por byte.
- Fuente oficial: [Build skills](https://learn.chatgpt.com/docs/build-skills), consultada el
  2026-07-27. Exige un directorio con `SKILL.md`, `name` y `description`, y documenta
  `$HOME/.agents/skills` como scope de usuario.

## Agente personalizado

- Ruta instalada: `$HOME/.codex/agents/vkm-implementer.toml`.
- Contrato fuente: `packages/create-vkm-kit/templates/agents/vkm-implementer.md`; el TOML
  conserva el implementador terso y de diff mínimo, sin metadata de modelo específica de Claude.
- Claves requeridas: `name`, `description`, `developer_instructions`.
- Fuente oficial: [Codex full manual — Subagents](https://developers.openai.com/codex/llms-full.txt),
  consultada el 2026-07-27.

## Hooks

- Configuración: `$HOME/.codex/hooks.json`.
- Scripts: `$HOME/.codex/hooks/`, con hashes en `$HOME/.codex/vkm-kit.assets.json`.
- Mapeo: `SessionStart` inyecta contexto del vault; `PreToolUse` protege
  `~/.codex/memories/` y aplica effort-gate; `PostToolUse` compacta salida de herramientas.
- Fuentes oficiales: [Hooks](https://learn.chatgpt.com/docs/hooks) y
  [Memories](https://learn.chatgpt.com/docs/customization/memories), consultadas el 2026-07-27.
  El merge reemplaza solo handlers con el stem de vkm-kit y conserva cualquier hook del usuario.

## Drift y seguimiento

- **Drift verificado:** Codex no soporta todavía `updatedMCPToolOutput`. El token-saver devuelve
  feedback compacto con `continue: false`; no puede mutar `tool_response` como Claude Code.
- **No verificado todavía / seguimiento:** `transcript_path` es inestable según la documentación;
  el effort-gate falla abierto si cambia el rollout. Preferir campos estables cuando Codex los publique.
- **No verificado todavía / seguimiento:** los hooks no gestionados requieren trust review con
  `/hooks`; el instalador no saltea esa confirmación.
- No volver a `~/.codex/prompts/*.md`: [Custom prompts](https://learn.chatgpt.com/docs/custom-prompts)
  está deprecado a favor de Skills.

## Checks

```bash
npm test --workspace @vkmikc/create-vkm-kit
npm run sync-agents:check
npm run lint
npm run typecheck
npm test
```

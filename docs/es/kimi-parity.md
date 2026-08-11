# Handoff de paridad con Kimi Code CLI

Verificado el 2026-08-11 contra la documentación oficial de Kimi Code (`kimi.com/code/docs/en/`)
**y** contra el CLI en vivo (`kimi` 0.34.0) donde los docs eran ambiguos. Esta nota permite que
una sesión futura de Claude Code mantenga alineadas las superficies de Claude y Kimi. Registro de
la decisión: ADR-0087 (`--ide kimi` sigue el precedente de ADR-0022 con Codex).

## Skills

- Ruta instalada: `~/.kimi-code/skills/{vkm-discipline,vkm-spec,vkm-design,vkm-research,vkm-verify,vkm-intake,vkm-ui-judge,vkm-seo}/`
  (las ocho skills del kit — el mismo set que Claude/Codex/Cursor). Todo el árbol se mueve con
  `KIMI_CODE_HOME`.
- Fuente: `packages/create-vkm-kit/templates/skills/`; el instalador copia todos los archivos
  de cada directorio y conserva cada `SKILL.md` byte por byte.
- Fuente oficial: [Skills](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html),
  consultada el 2026-08-11.
- Mantener en sync: si se añade o renombra un skill, actualizar `SKILL_NAMES`, los tests de
  `skills-install` y cada scope de instalación. `skill-count-drift.test.mjs` gatea los docs de
  paridad.

## Agente personalizado

- Ruta instalada: `~/.kimi-code/agents/vkm-implementer.md`.
- Contrato fuente: `packages/create-vkm-kit/templates/agents/vkm-implementer.kimi.md` — plantilla
  dedicada que conserva el implementador terso y de diff mínimo, sin el campo `model` específico
  de Claude (Kimi tolera frontmatter estilo Claude Code; los campos desconocidos se ignoran).
- Fuente oficial: [Agents](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents.html),
  consultada el 2026-08-11.

## Hooks

- Configuración: `~/.kimi-code/config.toml` — un **bloque gestionado** entre los comentarios TOML
  `# vkm-kit:start` / `# vkm-kit:end`, de modo que ningún escritor TOML toca los providers, las
  credenciales ni los `[[hooks]]` propios del usuario. Solo se emiten los cuatro campos
  documentados (`event`/`matcher`/`command`/`timeout`); `config.toml` se respalda antes de cada
  escritura gestionada.
- Scripts: `~/.kimi-code/hooks/`.
- Mapeo:
  - `UserPromptSubmit` → `kimi-session-start-vault-context.mjs` inyecta el mapa del vault y los
    recordatorios de memoria **solo en el primer prompt de cada sesión** (marcador sidecar en
    `~/.vkm/kimi-context-injected/`). No usa `SessionStart`: ese evento es solo de observación y
    su stdout nunca llega al contexto (verificado en vivo — el hook corrió, escribió su sidecar y
    no se inyectó nada).
  - `Stop` → `kimi-stop-vault-close-reminder.mjs` recuerda el ritual de cierre **una vez por
    sesión** cuando hubo trabajo de archivos sustantivo sin tocar el vault. Escanea el
    `~/.kimi-code/sessions/<wd>/session_<id>/agents/main/wire.jsonl` de la sesión, comparte las
    regex de política y el texto del hook de Claude verbatim, y bloquea con exit code 2.
- **Caveat del modo print:** `kimi -p` dispara `UserPromptSubmit` pero **no** `Stop` (verificado
  en vivo con un hook grabador: el payload nunca llegó). El recordatorio de cierre es por tanto
  una función del TUI interactivo; el script en sí está verificado end-to-end por invocación
  directa contra el `wire.jsonl` de una sesión real.
- Fuente oficial: [Hooks](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html),
  consultada el 2026-08-11. Bloquear = exit code 2 con la razón en stderr.
- No portados (siguen solo Claude/Codex): token-saver, telemetría, guarda de memoria nativa y
  effort-gate — Kimi no tiene auto-memoria nativa ni harness de `/effort`. El hook de keep-alive de
  Postgres tampoco está portado; la proyección funciona sin él.

## MCP

- Configuración: `~/.kimi-code/mcp.json` (se mueve con `KIMI_CODE_HOME`), con el mismo shape
  `{"mcpServers": {...}}` que Cursor; se fusiona con el mismo camino de código
  merge-preserve-backup.
- **No** existe `kimi mcp add` — el JSON ES la superficie de configuración documentada, y
  `npm run setup` verifica el cableado leyéndolo. La config MCP carga al iniciar la sesión: abre
  una sesión nueva y verifica con `/mcp`.
- Fuente oficial: [MCP](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html),
  consultada el 2026-08-11.

## Reglas

- Ruta instalada: `~/.kimi-code/AGENTS.md` — el bloque gestionado e idempotente de reglas de
  memoria, escrito por `--rules kimi` (también incluido en `--rules all`).

## Drift verificado y seguimiento

- **Drift verificado:** los docs mienten por omisión sobre `SessionStart` — su stdout se descarta,
  así que la inyección de contexto va por `UserPromptSubmit` con marcador de una vez por sesión.
  Consecuencia: una sesión reanudada no recibe re-inyección del contexto del vault (el marcador
  persiste entre reanudaciones). Aceptado — la inyección sobrevive en el transcript reanudado.
- **No verificado todavía / seguimiento:** Kimi no documenta `stop_hook_active`, así que el nudge
  de Stop se autolimita con su propio marcador de una vez por sesión. Revisar si Kimi publica un
  guard contra re-entrada.

## Checks

```bash
npm test --workspace @vkmikc/create-vkm-kit
node packages/create-vkm-kit/src/index.js --ide kimi --vault <tmp> --non-interactive
npm run sync-agents:check
npm run lint
npm run typecheck
```

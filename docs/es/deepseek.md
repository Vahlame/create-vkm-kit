> [🇬🇧 English](../en/deepseek.md) · 🇪🇸 Español

# DeepSeek V4

Cómo manejar el kit con **DeepSeek V4** (API, compatible OpenAI/Anthropic) y sacarle el
stack completo — memoria en vault, búsqueda híbrida, research, skills y reglas — afinado
para un modelo de razonamiento en lugar de Claude. Registro de decisión:
[ADR-0088](../adr/0088-deepseek-v4-first-class.md).

## Lo único que debes clavar: la key vive solo en el entorno

El kit lee `DEEPSEEK_API_KEY` del **entorno del proceso** que lanza el agente y los
servidores MCP. Nunca se escribe a disco, a `mcp.json`, a git ni a un log, y se elimina de
todo mensaje de error. Defínela en tu shell / llavero del SO — **nunca** en un archivo
commiteado:

```powershell
# solo la sesión actual
$env:DEEPSEEK_API_KEY = "<your-deepseek-key>"

# persistente (Windows, ámbito de usuario)
setx DEEPSEEK_API_KEY "<your-deepseek-key>"
```

`setx` solo afecta a **nuevos** shells — reinicia el host del agente después de definirla.

## Ejecutar DeepSeek dentro de un host de agente

DeepSeek no tiene `deepseek mcp add` ni una superficie de config propia — corre **dentro de
un host existente**, por eso no hay `--ide deepseek`. Cablea el kit para tu host como
siempre, y luego apunta ese host a la API de DeepSeek:

- **Claude Code** — DeepSeek publica un endpoint compatible con Anthropic. Apunta el
  harness a él (`ANTHROPIC_BASE_URL` y un id de modelo DeepSeek), e instala el kit normal
  (`--ide claude`). Los hooks del kit detectan el id DeepSeek desde el payload de sesión.
- **Cursor / Codex** — usa un provider compatible con OpenAI con
  `https://api.deepseek.com/v1` y un id DeepSeek; `--ide cursor` / `--ide codex` cablean el
  vault + híbrido + reglas + skills como siempre.

La detección de modelo es **agnóstica del host** y vive en los hooks y el effort-gate, así
que funciona con el host que uses.

## Hosts sin hooks (DSH, opencode, …)

Las superficies de hooks (bloque DeepSeek de SessionStart, effort gate, token-saver) solo
corren donde el kit puede cablearlas: Claude Code, Codex, Cursor, Kimi. Un host sin ninguna
de esas — p. ej. el DeepSeek Harness (DSH) — recibe igual las tres cosas que más importan,
sin ningún hook:

| Superficie       | Cómo llega al modelo en un host sin hooks                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bloque de reglas | El bloque `vkm-kit:start/end` en `AGENTS.md` se carga en cada sesión (el kit lo instala en el proyecto).                                                                                                                                                               |
| Skills           | DSH lee `~/.agents/skills` (el layout de Codex): instálalas con `node packages/create-vkm-kit/src/index.js --skills-dir <dir> --vault <vault>` o copiándolas tras una instalación `--ide codex`.                                                                       |
| MCP              | Solo si el host expone un registro MCP. DSH hoy **no expone ningún servicio MCP**, así que las tools `vault_*` no existen — el protocolo de memoria degrada con honestidad ("si ningún MCP responde, dilo"), y las skills + reglas funcionan igual en modo standalone. |

**Afinado de sesión flash (DSH):** `~/.dsh/settings.yaml` → `agent-default-model.reasoningEffort`.
Ponlo en `low` para un default flash: la guía del kit (abajo) dice low para extracción barata,
y `max` sobre flash hace cada mensaje más lento y más caro sin ganancia medida.

## Qué cambia "first-class" para DeepSeek

| Superficie         | Comportamiento DeepSeek                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effort gate        | Reconoce `deepseek-*`; aconseja `/effort` pero **nunca** propone `/model opus/sonnet/haiku`                                                                                                                |
| Hook SessionStart  | Inyecta un bloque corto solo para DeepSeek: thinking ON por defecto (razonamiento en `reasoning_content`), división `reasoning_effort` flash/pro, verifica resultados de tools, recordatorio de key en env |
| Perfiles de agente | Fila V4 en `_meta/agent-profiles.md` + nota dedicada `AGENTS/deepseek-v4.md` (recall acotado `scope: "AGENTS/deepseek-v4"`)                                                                                |
| Stack de research  | Curación/expansión/traducción/leads/resúmenes van a la API de DeepSeek — sin Ollama local                                                                                                                  |
| Embeddings         | Siguen locales (Ollama `/api/embed`) — DeepSeek no tiene endpoint de embeddings; el paso anti-duplicados simplemente se degrada sin él                                                                     |

## Backend de research (obscura-web)

Las llamadas LLM del research usan un selector de provider:

```text
OBSCURA_LLM_PROVIDER=auto     # default: DeepSeek si DEEPSEEK_API_KEY está definida, si no Ollama
OBSCURA_LLM_PROVIDER=deepseek # fuerza la API (openai es alias); error si no hay key
OBSCURA_LLM_PROVIDER=ollama   # fuerza modelos locales — el "la API se encareció"
OBSCURA_LLM_PROVIDER=none     # degrada cada llamada a los fallbacks heurísticos
```

`OBSCURA_DEEPSEEK_MODEL` elige el modelo (default `deepseek-v4-flash`; `deepseek-v4-pro`
para resúmenes/expansión de más calidad). `OBSCURA_DEEPSEEK_BASE_URL` cambia el endpoint.

Al instalar, la mitad no-secreta se expresa como flags (la key nunca es un flag):

```bash
node packages/create-vkm-kit/src/index.js --research-llm deepseek --deepseek-model deepseek-v4-pro ...
```

**Volver a modelos locales:** `OBSCURA_LLM_PROVIDER=ollama` (o quitar `DEEPSEEK_API_KEY`)
devuelve cada llamada del research a un Ollama local — en ambos sentidos, así cambias por
coste sin reinstalar.

## Modelo del subagente (Claude Code)

El template de subagente `vkm-implementer` usa por defecto `model: sonnet`, que es
incorrecto bajo DeepSeek. Sobrescríbelo con la variable que documenta el propio template:

```powershell
$env:CLAUDE_CODE_SUBAGENT_MODEL = "deepseek-v4-pro"
```

## Notas de afinado

- **Thinking está ON por defecto.** El razonamiento llega en un campo `reasoning_content`
  separado, no en el mensaje visible — no lo esperes en el texto del asistente.
- **El coste se afina con `reasoning_effort`**, no con `/model`: bajo para extracción
  barata, alto para lógica dura; `flash` para volumen/amplitud, `pro` para lógica dura de
  un solo paso.
- **Verifica los resultados de tools antes de confiar** — DeepSeek a veces es
  fluido-pero-equivocado en una alucinación rara.
- **Medido en flash (discipline-bench):** deepseek-v4-flash con la skill vkm-discipline
  rediseñada puntúa **92.5 vs 78.3 stock** (+14.3, IC 95% [2.5, 26.6]) en el bench de
  código con tests ocultos del kit — las skills no son decoración para este modelo. Los
  núcleos flash de los SKILL.md ("PROCEDURE — flash") son el orden de lectura recomendado
  para modelos flash; el mandato de casos borde y normalización vive dentro del núcleo, no
  en un reference.

← Volver al [índice de docs](README.md)

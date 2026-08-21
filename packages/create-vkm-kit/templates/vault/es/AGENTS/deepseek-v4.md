---
type: agent
status: active
agent: deepseek-v4
model: deepseek-v4-pro / deepseek-v4-flash
tags: [agent, deepseek, model]
---

# AGENT — DeepSeek V4

Memoria propia del agente para DeepSeek V4 (API, compatible OpenAI). Recall acotado:
`scope: "AGENTS/deepseek-v4"`.

## Veredictos

- [fact] 1M de contexto + razonamiento profundo barato; thinking ON por defecto — el razonamiento llega en un campo `reasoning_content` separado, no en el mensaje visible. #deepseek
- [fact] Ediciones agénticas multi-archivo fuertes; verifica los resultados de tools antes de confiar (fluido-pero-equivocado en la alucinación rara). #agent

## Lecciones

- [gotcha] Con thinking ON, `reasoning_effort` controla cuánto delibera: bajo para extracción barata, alto para lógica dura. #deepseek
- [gotcha] El stack de research lee `DEEPSEEK_API_KEY` SOLO del entorno — nunca lo commitees; vuelve a modelos locales con `OBSCURA_LLM_PROVIDER=ollama` si la API se encarece. #mcp
- [fact] flash para volumen/amplitud, pro para lógica dura de un solo paso. #deepseek

## Relacionado

- part_of [[_meta/agent-profiles]]
- relates_to [[PROJECTS/<proyecto>]]

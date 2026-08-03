---
type: agent
status: active
agent: vkm-implementer
model: claude-sonnet
created: 2026-07-20
updated: 2026-08-01
tags: [agent, vkm-implementer]
---

# AGENT — vkm-implementer

Ejecutor delegado para specs precisas (diff minimo, reporte terso). Recall acotado:
`scope: "AGENTS/vkm-implementer"`.

## Veredictos

- [decision] 2026-07-22 · delegarle renombrados mecanicos multi-archivo -> 14 archivos sin scope creep ni cambios de estilo colaterales #delegacion
- [fact] 2026-07-25 · respeta "no toques los tests" solo si la spec lo dice literal; una mencion vaga no basta #spec

## Lecciones

- [gotcha] 2026-08-01 · con una spec sin lista de gates marca "terminado" sin ejecutar nada -> incluir siempre los comandos de verificacion en la spec #testing

## Relacionado

- part_of [[_meta/agent-profiles]]
- relates_to [[PROJECTS/example-app]]

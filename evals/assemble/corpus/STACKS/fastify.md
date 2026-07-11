---
type: stack
created: 2026-02-20
tags: [stack, node, fastify]
---

# fastify

Framework HTTP de Node usado en las API de los proyectos de mesa de ayuda y
dashboard. Version 5 en produccion; plugins propios para auth y colas.

## Hechos verificados

- [fact] La serializacion de respuestas usa el schema declarado: un campo no declarado se omite del JSON sin error ni warning #stack #fastify
- [fact] La validacion de entrada con JSON Schema corre antes del handler; un payload invalido responde 400 sin tocar codigo propio #stack #fastify
- [fact] Los plugins encapsulan scope: un decorador registrado en un plugin hijo no existe en el padre, y ese aislamiento es intencional #stack #fastify
- [fact] El hook onRequest corre antes de parsear el body; auth va ahi para rechazar barato, no en preHandler #stack #fastify
- [fact] El logger pino viene integrado y el request-id se propaga con la opcion genReqId, sin middleware extra #stack #fastify

## Notas de operacion

- Subir de version mayor exige revisar los schemas de serializacion uno por
  uno: los campos omitidos en silencio son el modo de fallo tipico.
- El benchmark propio contra Express dio 2.3x mas requests por segundo en el
  listado de tickets, con el mismo handler y la misma base.

Relacionado: [[PROJECTS/ticket-hub]].

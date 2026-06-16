---
type: topic
created: 2026-01-13
tags: [stack, daemon]
---

# go

Lenguaje del daemon `obsidian-memoryd`. Verdict: unknown.

## Notas tecnicas

- Build tags para codigo cross-platform (Windows vs Unix).
- Inyeccion de dependencias via un `Runner` para aislar la E/S.
- Git sync con reintentos y backoff; vigila el vault y hace commit + push.
- En Windows compilar con `-H windowsgui` para no abrir consola.

## Veces visto

- memory-kit.

---
type: topic
created: 2026-01-16
tags: [practices, bad]
---

# confirmed-bad

Anti-patterns confirmados que disparan el coaching loop.

## Seguridad

- Secretos hardcodeados en el codigo fuente en vez de variables de entorno.
- Query SQL concatenada sin parameter binding (riesgo de inyeccion).

## Git

- `push --force` a `main` sin `--force-with-lease`.

## Tipado

- Falta de tipado en el boundary (DTOs del server sin tipos).

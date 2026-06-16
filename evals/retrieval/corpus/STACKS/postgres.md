---
type: topic
created: 2026-01-09
tags: [stack, database]
---

# postgres

Base de datos relacional. Verdict: like. El foco recurrente es Row Level
Security (RLS) para multi-tenancy.

## Notas tecnicas

- Las policies RLS se prueban como `anon` y como usuario autenticado.
- Una policy sin probar no esta lista, aunque compile.
- Supabase expone Postgres con realtime y auth integradas.

## Veces visto

- bike-shop, exam-generator.

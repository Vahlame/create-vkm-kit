---
type: meta
created: 2026-01-01
tags: [memory, preferences]
---

# MEMORY

## Perfil de trabajo

- Idioma preferido: espanol. Estilo directo, practico, accionable, sin emojis.
- Stack diario: TypeScript, Svelte 5, Tauri 2, Postgres / Supabase.
- Zona horaria America/Mexico_City (UTC-6).

## Reglas de memoria

- Registrar solo lo reutilizable mas alla de la sesion. Dedup antes de escribir.
- Separar hechos de hipotesis con la palabra explicita.
- Nunca guardar secretos, tokens ni rutas absolutas con datos personales.

## Lecciones que aplico siempre

- Git: nunca `push --force` a `main`; usar `--force-with-lease` solo en ramas propias.
- Postgres con RLS: probar como anon y como usuario autenticado antes de declarar lista una policy.
- Tauri 2 en Windows: el bootstrap del shell no debe bloquearse esperando SQLite o Stronghold.

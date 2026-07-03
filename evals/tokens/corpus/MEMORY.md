---
type: meta
created: 2026-01-01
tags: [memory, preferences]
---

# MEMORY

## Perfil de trabajo

- Idioma preferido: espanol. Estilo directo, practico, accionable, sin emojis.
- Commits convencionales (feat/fix/docs) en ingles; cuerpo del PR en espanol.
- Stack diario: TypeScript, Node 22, Postgres, Redis, Terraform sobre AWS.
- Zona horaria America/Costa_Rica (UTC-6). Semana laboral lunes-viernes.

## Reglas de memoria

- Registrar solo lo reutilizable mas alla de la sesion. Dedup antes de escribir.
- Separar hechos de hipotesis con la palabra explicita.
- Nunca guardar secretos, tokens ni rutas absolutas con datos personales.
- Una idea por nota; enlazar con [[wikilinks]] en vez de duplicar parrafos.

## Preferencias firmes

- Revisiones de codigo: diff corto primero, contexto despues; nada de refactors
  colados en un fix.
- Dependencias nuevas solo con justificacion escrita en el PR que las agrega.
- Toda migracion de esquema lleva script de rollback probado antes del deploy.

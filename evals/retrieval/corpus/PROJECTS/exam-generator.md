---
type: project
created: 2026-01-04
tags: [tauri, sveltekit, fastapi]
---

# exam-generator

Aplicacion de escritorio para generar examenes estandarizados (MEP Costa Rica).
Monorepo pnpm: shell + modulos como paquetes + backend FastAPI con RLS.

## Stack

- Shell: Tauri 2 + SvelteKit.
- Backend: FastAPI con Postgres y Row Level Security por tenant.
- Pipeline de contenido para banco de items cifrado.

## Sistema visual

- Design system por tokens: variables CSS `--mep-*`; cero hex en componentes.
- Algoritmo de calificacion REAC bit-exacto.

Relacionado: [[STACKS/tauri]], [[STACKS/postgres]], [[RULES/exam-rules]].

---
type: topic
created: 2026-01-08
tags: [stack, frontend]
---

# svelte

Framework de UI compilado. Svelte 5 introduce runes para reactividad explicita
sin VDOM. Verdict: like.

## Notas tecnicas

- Runes (`$state`, `$derived`, `$effect`) reemplazan los stores implicitos.
- Vite 6 como bundler; hot reload por debajo de 100 ms.
- Cuidado con env vars: `VITE_*` solo se inline con acceso estatico.

## Veces visto

- bike-shop, exam-generator.

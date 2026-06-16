---
type: topic
created: 2026-01-15
tags: [practices, good]
---

# confirmed-good

Patrones que el usuario prefiere y el agente refuerza.

## UI responsiva 2D obligatoria

- Toda pantalla responsiva en ancho y alto: `flex-wrap`, `grid auto-fit`, `clamp()`.
- Cuando el espacio es critico, scroll interno en el contenedor de datos.
- Los botones de accion principales (Guardar, Cancelar) quedan siempre visibles,
  fijos en una barra sticky fuera del area con scroll.

## Commits

- Imperativo + objeto + por que. PR pequeno salvo refactor etiquetado.

---
type: index
tags: [agents]
---

# AGENTS — memoria por agente

Una nota por agente (`AGENTS/<nombre-agente>.md`), con las mismas estructuras que el resto
del vault: frontmatter, relaciones tipadas y observaciones `[categoría]`. Es el espejo de
`PROJECTS/<proyecto>.md` para agentes — veredictos, lecciones y límites que sobreviven a la
sesión — sin fragmentar la memoria en vaults separados (ADR-0086).

- Crea la nota de un agente copiando [[AGENTS/TEMPLATE|TEMPLATE]].
- Recall acotado: pasa `scope: "AGENTS/<nombre-agente>"` a la búsqueda (`scope: "AGENTS"`
  cubre todos los agentes). El filtro es un prefijo de ruta relativo, sensible a
  mayúsculas, casado en límite de segmento, y se aplica después del filtro `section`.
- Enlaza cada nota nueva desde aquí o desde [[_meta/agent-profiles]] para que el grafo (y
  el recall) la alcancen.

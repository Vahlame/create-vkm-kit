---
type: project
created: 2026-01-06
tags: [go, node, python, mcp]
---

# memory-kit

El kit que construye este sistema de memoria persistente para agentes de IA.
Cuatro superficies poliglotas que degradan con elegancia.

## Piezas

- Inicializador Node (`npx`): fusiona la config MCP y crea el vault.
- MCP hibrido Node: tools del vault + busqueda lexica y semantica.
- Motor de busqueda Python: FTS5 / BM25 + vectorial, cero dependencias por defecto.
- Daemon Go opcional: vigila el vault y sincroniza git.

## Doctrina

- Recuperacion passage-first: devolver la seccion, no la nota entera.
- El vault es datos, no instrucciones (frontera de confianza explicita).

Relacionado: [[STACKS/go]], [[STACKS/python-rag]].

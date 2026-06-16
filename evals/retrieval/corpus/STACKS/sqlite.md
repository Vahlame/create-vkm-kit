---
type: topic
created: 2026-01-10
tags: [stack, database]
---

# sqlite

Base de datos embebida en un solo archivo. Verdict: unknown.

## Notas tecnicas

- Modo WAL para concurrencia lectura/escritura.
- Online Backup API para copiar la base sin detener la app.
- Error 14 ("unable to open database file") suele ser ruta o permisos.

## Veces visto

- app-inventory.

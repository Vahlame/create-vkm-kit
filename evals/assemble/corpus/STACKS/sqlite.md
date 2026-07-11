---
type: stack
created: 2026-04-01
tags: [stack, sqlite, database]
---

# sqlite

Base embebida de los proyectos offline-first (planificador de menus) y de los
indices locales del kit de memoria. Un archivo, cero servidor.

## Hechos verificados

- [fact] El modo WAL permite lectores concurrentes con un escritor; el checkpoint bloquea si un lector mantiene una transaccion abierta #stack #sqlite
- [fact] La Online Backup API copia la base sin detener la app; es el mecanismo del respaldo nocturno de las cocinas #stack #sqlite
- [fact] El error 14 "unable to open database file" casi siempre es ruta relativa o permisos del directorio, no corrupcion #stack #sqlite
- [fact] FTS5 con tokenizador unicode61 y prefijos cubre busqueda local en espanol sin dependencias externas #stack #sqlite
- [fact] PRAGMA user_version guarda el numero de migracion aplicado; verificarlo al arrancar detecta binarios viejos contra bases nuevas #stack #sqlite

## Notas de operacion

- Las transacciones largas son el enemigo: toda escritura de la app va en
  transacciones cortas y los reportes usan snapshots de lectura.
- VACUUM completo solo en mantenimiento programado; en una tableta de cocina
  tarda minutos y parece cuelgue.

Relacionado: [[PROJECTS/menu-planner]].

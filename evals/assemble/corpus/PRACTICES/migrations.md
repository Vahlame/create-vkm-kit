---
type: practice
created: 2026-03-18
tags: [migrations, database, deploy]
---

# migrations

Como se migra esquema en produccion en todos los proyectos, sin ventanas de
mantenimiento. Nacida de la migracion de particiones de la mesa de ayuda.

## Reglas confirmadas

- Patron expand-contract siempre: primero se expande el esquema (columna o
  tabla nueva), se despliega codigo que escribe en ambos lados, y solo cuando
  el codigo viejo desaparecio se contrae borrando lo antiguo.
- Toda migracion es compatible hacia atras exactamente un release; el rollback
  es siempre redeploy de la imagen anterior, jamas una migracion inversa a
  mano en caliente.
- Backfill por lotes con cursor de progreso persistido: lotes de 50k, pausa
  adaptativa segun replication lag, y reanudable tras cualquier corte sin
  duplicar filas. La doble escritura via trigger cubre el hueco mientras
  tanto.
- Las migraciones corren en CI con lock advisory antes del canario; dos deploys
  simultaneos no pueden migrar a la vez.

## Antipatrones vistos

- Migrar y desplegar codigo en el mismo paso: cualquier fallo deja esquema y
  codigo desalineados y el rollback ya no es trivial.
- Backfill sin ordenar por PK ni guardar cursor: tras un corte hay que empezar
  de cero o, peor, se duplican filas.
- Renombrar columna en un solo paso: es un drop + add disfrazado y rompe al
  codigo viejo durante el canario.

Relacionado: [[PROJECTS/ticket-hub]], [[PROJECTS/menu-planner]].

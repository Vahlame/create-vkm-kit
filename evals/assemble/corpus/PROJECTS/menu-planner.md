---
type: project
created: 2026-04-14
tags: [tauri, sqlite, svelte, catering]
---

# menu-planner

Planificador de menus y escandallo de costos para una empresa de catering con
ocho cocinas. App de escritorio Tauri + Svelte con SQLite local, pensada para
funcionar sin red dentro de las cocinas y sincronizar al volver la conexion.
En produccion desde junio; unas 300 recetas activas y 40 usuarios.

## Arquitectura

- App offline-first: toda escritura va primero a SQLite local en modo WAL; un
  proceso de sincronizacion empuja y trae cambios cuando hay red.
- El servidor central es una API minima sobre Postgres que solo arbitra
  conflictos y reparte deltas; las cocinas nunca consultan al servidor para
  operar el dia a dia.
- Cada receta versiona sus ingredientes: cambiar un escandallo crea version
  nueva y los menus ya planificados siguen apuntando a la version con la que
  se costearon.
- El calculo de alergenos se deriva de los ingredientes, nunca se captura a
  mano; un alergeno manual desincronizado es un riesgo legal, no un bug.

## Decisiones

- [decision] SQLite en modo WAL con un solo hilo escritor por cocina; los checkpoints corren al cerrar sesion, nunca durante el servicio de comidas #sqlite
- [decision] Sincronizacion por deltas con reloj logico de Lamport por registro; la hora de pared de las tabletas de cocina es basura y no se confia en ella #sync
- [decision] Conflictos de receta se resuelven con last-writer-wins por campo + bitacora visible; la cocinera jefa revisa la bitacora, no un merge automatico silencioso #sync
- [decision] El escandallo de costos usa precios congelados por semana; el precio vivo del proveedor hacia imposible reproducir el margen de un menu ya vendido #costos
- [decision] Exportacion de menus a PDF renderizada localmente con la webview; el render en servidor exigia red justo donde no la hay #offline
- [decision] Nada de ORM: SQL plano con migraciones numeradas embebidas en el binario y verificadas al arrancar #sqlite

## Gotchas

- [gotcha] El checkpoint WAL bloquea a los lectores si un proceso mantiene una transaccion abierta; una pestana de reportes olvidada detuvo la captura una manana entera #sqlite
- [gotcha] El reloj de las tabletas retrocede tras cada corte de luz en cocina; cualquier orden basado en hora de pared duplica o pierde deltas de sincronizacion #sync
- [gotcha] Los precios importados del proveedor llegan con coma decimal y separador de miles inconsistente; parsear sin normalizar corrompio el escandallo de tres recetas #costos
- [gotcha] La webview de Tauri limita el tamano del PDF exportado; un menu de temporada de 60 paginas hay que trocearlo por semanas #offline

## Sincronizacion offline

- Cada registro lleva `(reloj_lamport, cocina_id)` como version; el servidor
  solo acepta un delta si su version supera la conocida y en empate gana el
  `cocina_id` menor, regla estable y explicable.
- La cola de deltas pendientes vive en la misma base SQLite; un corte de luz a
  mitad de sincronizacion no pierde nada porque el envio es idempotente y
  reanudable por cursor.
- El primer arranque tras una semana sin red trae unos 2000 deltas; se aplican
  en transaccion por lotes de 200 para no bloquear la UI de la cocina.
- La bitacora de conflictos muestra campo, valor local, valor remoto y quien
  gano; las cocinas la revisan el lunes y en tres meses solo hubo dos
  conflictos reales.

## Escandallo de costos

- El costo de una receta suma ingredientes por version con los precios de la
  semana congelada; el margen del menu se recalcula solo al cambiar de semana
  o al republicar la receta.
- Los precios del proveedor se importan de un CSV semanal con validacion en
  dos fases: primero se valida el archivo entero y se reporta cada fila mala
  con numero de linea; solo si todo es valido se aplica en una transaccion.
- Mermas por tipo de ingrediente (15% verduras, 8% carnes) se aplican en el
  calculo, no en la captura; cambiar la merma re-costea todo el catalogo en
  segundos gracias a que el calculo es una vista materializada local.
- El informe de margen por menu fue la metrica que detecto un precio de
  azafran mal importado (100x) antes de que llegara a un presupuesto.

## Alergenos y fichas tecnicas

- La matriz de alergenos por receta se deriva con una consulta recursiva sobre
  sub-recetas; una salsa dentro de un plato propaga sus alergenos hacia
  arriba sin intervencion manual.
- Las fichas tecnicas se imprimen desde la misma version congelada del
  escandallo, asi la ficha en la pared de la cocina coincide con el costo que
  aprobo la oficina.
- Cambiar un ingrediente por otro equivalente exige confirmar la diferencia de
  alergenos en pantalla; el reemplazo silencioso fue vetado tras un simulacro
  de auditoria.

## Rendimiento medido

- Recalcular el escandallo completo (300 recetas, 8 niveles de sub-receta):
  1.4 s en la tableta mas vieja; la version con ORM tardaba 22 s.
- La busqueda de recetas usa FTS5 local con prefijos; resultados en menos de
  50 ms escribiendo, sin red, que era el requisito de cocina.
- La sincronizacion tras un dia normal (unos 150 deltas) tarda menos de 3 s
  en 4G; el peor caso medido fue 40 s tras una semana desconectada.

## Runbook corto

- Publicar version: tag en main, CI firma los binarios de escritorio y sube el
  manifiesto de auto-update; las cocinas actualizan al abrir la app.
- Si una cocina reporta datos viejos: revisar la bitacora de sincronizacion
  local antes de tocar el servidor; el 90% de los casos es reloj retrocedido.
- Restaurar una base local corrupta: copiar el ultimo respaldo nocturno del
  NAS de la cocina y dejar que la sincronizacion traiga el delta restante.

Relacionado: [[STACKS/sqlite]], [[PRACTICES/observability]],
[[PRACTICES/migrations]].

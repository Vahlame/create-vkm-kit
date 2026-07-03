---
type: project
created: 2026-04-15
tags: [electron, sqlite, hacienda, pos]
---

# pos-terminal

Punto de venta de escritorio para ferreterias (Electron + SQLite local +
sincronizacion a la nube). Debe operar dias enteros sin internet y facturar
electronicamente cuando vuelve la conexion.

## Modo offline

- SQLite es la fuente de verdad local; cada venta se escribe en una
  transaccion con su detalle y queda en estado `pendiente_sync`.
- La sincronizacion es un log de operaciones (outbox) con numero de secuencia
  por terminal; el servidor aplica en orden y responde el ultimo aplicado, asi
  un corte a mitad de lote no duplica ventas.
- Conflictos: el precio del catalogo central gana; el stock local se
  reconcilia con un conteo diferido, nunca se bloquea la venta por stock.

## Facturacion electronica (Hacienda)

- La factura se firma localmente (XAdES) y se encola; el envio a Hacienda
  corre solo con conexion, con reintentos cada 5 minutos y tope de 72 horas
  segun reglamento.
- La clave numerica de 50 digitos se genera al momento de la venta aunque no
  haya internet: consecutivo local por terminal + situacion "contingencia"
  cuando el envio sale de la ventana normal.
- Respuestas de Hacienda (aceptado/rechazado) se guardan crudas; un rechazo
  por cedula mal formada se reprocesa corrigiendo solo el receptor, sin tocar
  el consecutivo.

## Impresion termica

- Impresoras ESC/POS por USB; el driver propio escribe raw al endpoint, sin
  spooler de Windows, porque el spooler reordenaba tickets bajo carga.
- Cola de impresion propia con reintento y corte de papel explicito; si la
  impresora esta sin papel, la venta NO se bloquea: el ticket queda en cola y
  se reimprime desde el historial.
- Codigo de barras Code128 del documento en el pie del ticket; el ancho de
  modulo se calibro por modelo de impresora (tabla en `printers.json`).

## Autenticacion y roles

- Login local con PIN por cajero + JWT contra la nube cuando hay conexion
  para operaciones administrativas (anulaciones, descuentos mayores al 10%).
- El refresh token de administrador expira en 8 horas y se guarda cifrado con
  DPAPI; en las terminales compartidas nunca se recuerda la sesion admin.

## Sincronizacion de catalogo

- El catalogo central baja como snapshot versionado + deltas; una terminal
  que estuvo apagada una semana aplica el snapshot, no 7 dias de deltas.
- Los precios tienen vigencia con fecha: el delta puede llegar antes de que
  el precio aplique, y la terminal lo activa sola a medianoche local.
- Imagenes de productos en cache local con limite de 2 GB y LRU; la ferreteria
  del puerto tiene 4G intermitente y no puede depender de la nube para
  mostrar una foto.

## Reportes de caja

- Cierre de caja en dos pasos: conteo ciego del cajero primero, luego el
  sistema muestra la diferencia; mostrar el esperado antes sesgaba el conteo
  (lo pidio la duena tras detectar faltantes repetidos).
- El reporte Z del dia se genera desde SQLite local y se sella con hash
  encadenado al reporte anterior; cualquier edicion posterior rompe la cadena
  y se nota en la auditoria.
- Exportacion mensual contable en el formato del contador (CSV con columnas
  fijas); se valido con el contador real antes de programarla, no despues.

## Actualizaciones de la app

- Canal estable y canal piloto: la ferreteria del centro recibe versiones una
  semana antes; dos bugs de impresion se atraparon ahi y nunca llegaron al
  resto.
- La actualizacion se aplica al cerrar la caja, nunca durante ventas; un
  update a media tarde en el piloto congelo una cola de tickets y se decidio
  la regla desde entonces.
- Rollback local: el instalador conserva la version anterior y un acceso
  directo de emergencia; el rollback NO toca la base local (las migraciones
  de esquema son solo aditivas entre versiones consecutivas).

## Runbook corto

- Terminal no sincroniza: revisar primero el reloj del sistema (el JWT
  rechaza por skew mayor a 2 minutos), despues el estado del outbox
  (`SELECT estado, COUNT(*) FROM outbox GROUP BY 1`).
- Factura rechazada por Hacienda: NUNCA regenerar la clave; corregir el campo
  rechazado y reenviar con el mismo consecutivo (el reglamento lo permite y
  regenerar rompe la trazabilidad contable).
- Impresora imprime simbolos: casi siempre es el ancho de modulo del codigo
  de barras mal calibrado para ese modelo; tabla en `printers.json`.

Relacionado: [[STACKS/redis]], [[SESSION_LOG]].
